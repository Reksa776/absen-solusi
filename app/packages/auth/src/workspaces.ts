import { createHash, randomBytes, randomUUID } from "node:crypto";

import {
  createDefaultRolesForWorkspace,
  enqueueAuditOutbox,
  isUuid,
  resolveMemberPermissions,
  systemDb,
  withTenant,
  writeAudit,
  type Prisma,
  type TenantContext,
} from "@absensi/database";
import { isRoleKey, type RoleKey } from "@absensi/permissions";

import { assertEmail, assertName, assertRoleKey } from "./users.js";
import { HttpError } from "./http.js";
import { logger } from "./logger.js";
import { revokeAllSessionsForUser } from "./session.js";
import {
  evaluateInvitationRole,
  evaluateOwnershipTransfer,
  evaluateRoleChange,
  type SecurityDecision,
} from "./role-policy.js";

function assertSecurityDecision(decision: SecurityDecision): void {
  if (!decision.allowed) {
    throw new HttpError(decision.status, decision.code, decision.message);
  }
}

export const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const OWNER_ROLE: RoleKey = "WORKSPACE_OWNER";

async function safeAudit(input: Parameters<typeof writeAudit>[0]): Promise<void> {
  try {
    await writeAudit(input);
  } catch (error) {
    // Aksi non-risiko (invite): outbox + retry; aksi berisiko tetap memakai
    // writeAudit di dalam transaksi dan tidak pernah lewat jalur ini.
    try {
      await enqueueAuditOutbox(input);
    } catch (outboxError) {
      logger.error("audit outbox write failed", { action: input.action, error: outboxError });
    }
  }
}

/**
 * Lock order for every role mutation:
 * workspaces row -> workspace_members -> member_roles.
 * The workspace row is stable, so it serializes PATCH role and ownership
 * transfer without locking a member_roles row that may be deleted/moved.
 */
async function lockWorkspaceForRoleMutation(
  tx: Prisma.TransactionClient,
  tenantId: string,
): Promise<void> {
  const rows = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM workspaces
    WHERE id = ${tenantId}
    FOR UPDATE
  `;
  if (rows.length !== 1) {
    throw new HttpError(404, "WORKSPACE_NOT_FOUND", "Workspace tidak ditemukan");
  }
  const workspace = await tx.workspace.findFirst({
    where: { id: tenantId },
    select: { status: true },
  });
  if (!workspace || workspace.status !== "ACTIVE") {
    throw new HttpError(404, "WORKSPACE_NOT_FOUND", "Workspace tidak ditemukan");
  }
}

function slugifyWorkspace(name: string): string {
  const base = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return `${base || "workspace"}-${randomUUID().slice(0, 8)}`;
}

export type CreateWorkspaceInput = {
  userId: string;
  name: string;
  ip?: string | null | undefined;
  userAgent?: string | null | undefined;
};

/**
 * Create workspace + provisioning 6 role + membership ACTIVE + owner dalam
 * satu transaksi. Bila satu langkah gagal, seluruh perubahan di-rollback
 * (ekuivalen dengan menghapus workspace dan cascade-nya).
 */
export async function createWorkspace(input: CreateWorkspaceInput): Promise<{
  workspace: { id: string; name: string; slug: string };
  memberId: string;
  roles: Record<RoleKey, string>;
}> {
  const name = assertName(input.name);
  const id = randomUUID();
  const memberId = randomUUID();
  const slug = slugifyWorkspace(name);

  // SYSTEM: workspace belum ada, jadi provisioning berjalan sebelum tenant context.
  const db = systemDb();
  const roles = await db.$transaction(async (tx) => {
    const user = await tx.user.findUnique({ where: { id: input.userId } });
    if (!user || user.status !== "ACTIVE") {
      throw new HttpError(401, "UNAUTHENTICATED", "User tidak aktif");
    }
    await tx.workspace.create({ data: { id, name, slug } });
    const created = await createDefaultRolesForWorkspace(tx, id);
    await tx.workspaceMember.create({
      data: { id: memberId, tenantId: id, userId: input.userId, status: "ACTIVE", joinedAt: new Date() },
    });
    await tx.memberRole.create({
      data: { tenantId: id, memberId, roleId: created[OWNER_ROLE] },
    });
    // Aksi berisiko: audit wajib ikut transaksi; kegagalan audit membatalkan
    // workspace dan seluruh provisioning.
    await writeAudit(
      {
        tenantId: id,
        actorType: "USER",
        actorUserId: input.userId,
        actorMemberId: memberId,
        action: "workspace.create",
        resourceType: "workspace",
        resourceId: id,
        metadata: { slug },
        ip: input.ip ?? null,
        userAgent: input.userAgent ?? null,
      },
      tx,
    );
    return created;
  });

  return { workspace: { id, name, slug }, memberId, roles };
}

/** :workspaceId hanya klaim; otoritas tetap dari session. */
export function assertWorkspaceClaim(ctx: TenantContext, workspaceId: string): void {
  if (workspaceId !== ctx.tenantId) {
    // Identik untuk workspace yang tidak ada dan yang bukan miliknya.
    throw new HttpError(404, "WORKSPACE_NOT_FOUND", "Workspace tidak ditemukan");
  }
}

/**
 * Read route fail-closed: workspace asing dan workspace yang tidak ada sama-
 * sama 403 dengan body identik. Status baca tidak boleh membocorkan eksistensi
 * workspace lewat perbedaan 403/404.
 */
export function assertWorkspaceReadClaim(ctx: TenantContext, workspaceId: string): void {
  if (workspaceId !== ctx.tenantId) {
    throw new HttpError(403, "WORKSPACE_NOT_FOUND", "Workspace tidak ditemukan");
  }
}

export type InviteMemberInput = {
  ctx: TenantContext;
  workspaceId: string;
  email: string;
  role?: string | undefined;
  ip?: string | null | undefined;
  userAgent?: string | null | undefined;
  now?: Date | undefined;
};

export type InviteMemberResult = {
  invitationId: string;
  email: string;
  roleKey: RoleKey;
  expiresAt: Date;
  /** Token mentah hanya dikembalikan sekali; DB menyimpan SHA-256-nya. */
  token: string;
};

export type InvitationResponse = Omit<InviteMemberResult, "token"> & {
  token?: string;
  devTokenEcho?: true;
};

/**
 * Respons API produksi tidak boleh memuat token undangan. Echo token hanya
 * tersedia di non-production dan harus diaktifkan eksplisit.
 */
export function invitationResponse(
  result: InviteMemberResult,
  options: { production?: boolean; echoDevToken?: boolean } = {},
): InvitationResponse {
  const { token, ...safe } = result;
  const production = options.production ?? process.env.NODE_ENV === "production";
  if (!production && options.echoDevToken === true) {
    return { ...safe, token, devTokenEcho: true };
  }
  return safe;
}

export async function inviteMember(input: InviteMemberInput): Promise<InviteMemberResult> {
  assertWorkspaceClaim(input.ctx, input.workspaceId);
  const email = assertEmail(input.email);
  const roleKey = assertRoleKey(input.role ?? "VIEWER");
  // Undangan menetapkan role saat diterima; ownership tidak boleh lewat sini.
  assertSecurityDecision(
    evaluateInvitationRole({ actorRoleKeys: input.ctx.roleKeys, roleKey }),
  );
  const now = input.now ?? new Date();
  const expiresAt = new Date(now.getTime() + INVITATION_TTL_MS);
  const token = randomBytes(32).toString("base64url");
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const invitationId = randomUUID();

  await withTenant(input.ctx, async (db) => {
    const role = await db.role.findFirst({ where: { key: roleKey } });
    if (!role) throw new HttpError(400, "INVALID_ROLE", "Role tidak tersedia di workspace ini");

    const member = await db.workspaceMember.findFirst({
      where: { user: { email } },
    });
    if (member) {
      throw new HttpError(409, "ALREADY_MEMBER", "Email sudah menjadi member workspace");
    }

    const pending = await db.workspaceInvitation.findFirst({
      where: { email, status: "PENDING", expiresAt: { gt: now } },
    });
    if (pending) {
      throw new HttpError(409, "INVITATION_PENDING", "Undangan untuk email ini masih pending");
    }

    await db.workspaceInvitation.create({
      data: {
        id: invitationId,
        tenantId: input.ctx.tenantId,
        email,
        roleId: role.id,
        tokenHash,
        status: "PENDING",
        expiresAt,
        invitedByUserId: input.ctx.userId,
      },
    });
  });

  await safeAudit({
    tenantId: input.ctx.tenantId,
    actorType: "USER",
    actorUserId: input.ctx.userId,
    actorMemberId: input.ctx.memberId,
    action: "member.invite",
    resourceType: "member",
    resourceId: invitationId,
    // token & token_hash tidak pernah masuk metadata (juga diredaksi otomatis).
    metadata: { email, roleKey },
    ip: input.ip ?? null,
    userAgent: input.userAgent ?? null,
  });

  return { invitationId, email, roleKey, expiresAt, token };
}

export type ChangeRoleInput = {
  ctx: TenantContext;
  workspaceId: string;
  memberId: string;
  role: string;
  ip?: string | null | undefined;
  userAgent?: string | null | undefined;
};

export type ChangeRoleResult = {
  changed: boolean;
  roleKey: RoleKey;
  from: string[];
};

/**
 * Insert role baru sebelum menghapus role lama; self-change ditolak.
 * Semua pembacaan yang menentukan otorisasi dilakukan setelah workspace lock.
 */
export async function changeMemberRole(input: ChangeRoleInput): Promise<ChangeRoleResult> {
  assertWorkspaceClaim(input.ctx, input.workspaceId);
  const roleKey = assertRoleKey(input.role);
  if (input.memberId === input.ctx.memberId) {
    throw new HttpError(400, "SELF_ROLE_CHANGE", "Tidak dapat mengubah role sendiri");
  }

  const outcome = await withTenant(input.ctx, async (db) =>
    db.$transaction(async (tx) => {
      await lockWorkspaceForRoleMutation(tx, input.ctx.tenantId);

      const actor = await tx.workspaceMember.findFirst({
        where: { id: input.ctx.memberId },
        select: { id: true, status: true },
      });
      if (!actor || actor.status !== "ACTIVE") {
        throw new HttpError(403, "FORBIDDEN", "Role Anda tidak dapat mengelola role");
      }
      const actorAccess = await resolveMemberPermissions(
        tx,
        input.ctx.tenantId,
        actor.id,
      );
      if (!actorAccess.permissions.includes("role.manage")) {
        throw new HttpError(403, "FORBIDDEN", "Role Anda tidak dapat mengelola role");
      }

      const target = await tx.workspaceMember.findFirst({
        where: { id: input.memberId },
        include: { roles: { include: { role: { select: { key: true } } } } },
      });
      if (!target || target.status !== "ACTIVE") {
        throw new HttpError(404, "MEMBER_NOT_FOUND", "Member tidak ditemukan");
      }
      if (target.id === actor.id) {
        throw new HttpError(400, "SELF_ROLE_CHANGE", "Tidak dapat mengubah role sendiri");
      }

      const role = await tx.role.findFirst({ where: { key: roleKey } });
      if (!role) throw new HttpError(400, "INVALID_ROLE", "Role tidak tersedia di workspace ini");
      const ownerRole = await tx.role.findFirst({ where: { key: OWNER_ROLE } });
      if (!ownerRole) {
        throw new HttpError(409, "ROLE_NOT_PROVISIONED", "Role workspace tidak lengkap");
      }

      const from = target.roles.map((assignment) => assignment.roleId).sort();
      const targetRoleKeys = target.roles.map((assignment) => assignment.role.key);
      const ownerCount = await tx.memberRole.count({
        where: { tenantId: input.ctx.tenantId, roleId: ownerRole.id },
      });
      assertSecurityDecision(
        evaluateRoleChange({
          actorMemberId: actor.id,
          actorRoleKeys: actorAccess.roleKeys,
          targetMemberId: target.id,
          targetRoleKeys,
          nextRoleKey: roleKey,
          ownerCount,
        }),
      );

      const onlySameRole = target.roles.length === 1 && target.roles[0]?.roleId === role.id;
      if (onlySameRole) {
        return { changed: false, from, targetUserId: target.userId };
      }

      await tx.memberRole.upsert({
        where: {
          tenantId_memberId_roleId: {
            tenantId: input.ctx.tenantId,
            memberId: target.id,
            roleId: role.id,
          },
        },
        create: { tenantId: input.ctx.tenantId, memberId: target.id, roleId: role.id },
        update: {},
      });
      // Hapus hanya assignment yang benar-benar dibaca setelah lock. Jangan
      // memakai predicate `roleId != newRole` yang bisa menghapus owner baru.
      const rolesToRemove = from.filter((roleId) => roleId !== role.id);
      if (rolesToRemove.length > 0) {
        await tx.memberRole.deleteMany({
          where: {
            tenantId: input.ctx.tenantId,
            memberId: target.id,
            roleId: { in: rolesToRemove },
          },
        });
      }

      const ownersAfter = await tx.memberRole.count({
        where: { tenantId: input.ctx.tenantId, roleId: ownerRole.id },
      });
      if (ownersAfter < 1) {
        throw new HttpError(
          409,
          "OWNERSHIP_INVARIANT",
          "Workspace harus memiliki minimal satu owner",
        );
      }

      // Aksi berisiko: audit berada di transaksi yang sama.
      await writeAudit(
        {
          tenantId: input.ctx.tenantId,
          actorType: "USER",
          actorUserId: input.ctx.userId,
          actorMemberId: input.ctx.memberId,
          action: "role.change",
          resourceType: "role",
          resourceId: input.memberId,
          metadata: { from, to: roleKey },
          ip: input.ip ?? null,
          userAgent: input.userAgent ?? null,
        },
        tx,
      );

      return { changed: true, from, targetUserId: target.userId };
    }),
  );

  if (outcome.changed) {
    // Privilege target berubah: seluruh sesi lama target tidak boleh tetap
    // membawa otorisasi lama. Token baru harus diperoleh lewat login ulang.
    await revokeAllSessionsForUser(outcome.targetUserId);
  }

  return { changed: outcome.changed, roleKey, from: outcome.from };
}

export type TransferOwnershipInput = {
  ctx: TenantContext;
  workspaceId: string;
  targetMemberId: string;
  ip?: string | null | undefined;
  userAgent?: string | null | undefined;
};

export type TransferOwnershipResult = {
  fromMemberId: string;
  toMemberId: string;
  ownerRoleKey: RoleKey;
  formerOwnerRoleKey: RoleKey;
};

/**
 * Satu-satunya jalur sah untuk memindahkan WORKSPACE_OWNER. Owner lama
 * diturunkan menjadi WORKSPACE_ADMIN, target menjadi satu-satunya owner.
 * Kedua perubahan role terjadi dalam satu transaksi.
 */
export async function transferOwnership(
  input: TransferOwnershipInput,
): Promise<TransferOwnershipResult> {
  assertWorkspaceClaim(input.ctx, input.workspaceId);
  if (!isUuid(input.targetMemberId)) {
    throw new HttpError(400, "INVALID_INPUT", "memberId tidak valid");
  }

  return withTenant(input.ctx, async (db) => {
    const outcome = await db.$transaction(async (tx) => {
      await lockWorkspaceForRoleMutation(tx, input.ctx.tenantId);

      const ownerRole = await tx.role.findFirst({ where: { key: OWNER_ROLE } });
      const adminRole = await tx.role.findFirst({ where: { key: "WORKSPACE_ADMIN" } });
      if (!ownerRole || !adminRole) {
        throw new HttpError(409, "ROLE_NOT_PROVISIONED", "Role workspace tidak lengkap");
      }

      const actor = await tx.workspaceMember.findFirst({
        where: { id: input.ctx.memberId },
        select: { id: true, status: true },
      });
      if (!actor || actor.status !== "ACTIVE") {
        throw new HttpError(403, "FORBIDDEN", "Hanya owner workspace yang dapat mentransfer ownership");
      }
      const actorAccess = await resolveMemberPermissions(
        tx,
        input.ctx.tenantId,
        actor.id,
      );

      const currentOwners = await tx.memberRole.findMany({
        where: { tenantId: input.ctx.tenantId, roleId: ownerRole.id },
        select: { memberId: true },
      });
      const onlyOwner =
        currentOwners.length === 1 ? currentOwners[0]?.memberId : undefined;

      const target = await tx.workspaceMember.findFirst({
        where: { id: input.targetMemberId },
        include: { roles: { include: { role: { select: { key: true } } } } },
      });
      if (!target || target.status !== "ACTIVE") {
        throw new HttpError(404, "MEMBER_NOT_FOUND", "Member tidak ditemukan");
      }
      const targetRoleKeys = target.roles.map((assignment) => assignment.role.key);
      const targetIsOwner = targetRoleKeys.includes(OWNER_ROLE);

      // Aktor yang memulai request sebagai owner tetapi sudah kehilangan
      // ownership mendapatkan conflict, bukan 403 yang menyesatkan. Target yang
      // sudah owner tetap dilaporkan ALREADY_OWNER oleh policy di bawah.
      if (
        !targetIsOwner &&
        input.ctx.roleKeys.includes(OWNER_ROLE) &&
        onlyOwner !== input.ctx.memberId
      ) {
        throw new HttpError(
          409,
          "OWNERSHIP_CHANGED",
          "Ownership workspace sudah berubah; muat ulang data",
        );
      }
      if (!actorAccess.permissions.includes("workspace.manage")) {
        throw new HttpError(403, "FORBIDDEN", "Hanya owner workspace yang dapat mentransfer ownership");
      }

      assertSecurityDecision(
        evaluateOwnershipTransfer({
          actorMemberId: actor.id,
          actorRoleKeys: actorAccess.roleKeys,
          targetMemberId: target.id,
          targetRoleKeys,
          targetStatus: target.status,
        }),
      );

      if (onlyOwner !== input.ctx.memberId) {
        throw new HttpError(
          409,
          "OWNERSHIP_CHANGED",
          "Ownership workspace sudah berubah; muat ulang data",
        );
      }

      await tx.memberRole.deleteMany({
        where: { tenantId: input.ctx.tenantId, memberId: target.id },
      });
      await tx.memberRole.create({
        data: { tenantId: input.ctx.tenantId, memberId: target.id, roleId: ownerRole.id },
      });
      await tx.memberRole.deleteMany({
        where: { tenantId: input.ctx.tenantId, memberId: input.ctx.memberId },
      });
      await tx.memberRole.create({
        data: {
          tenantId: input.ctx.tenantId,
          memberId: input.ctx.memberId,
          roleId: adminRole.id,
        },
      });

      const owners = await tx.memberRole.count({
        where: { tenantId: input.ctx.tenantId, roleId: ownerRole.id },
      });
      if (owners !== 1) {
        throw new HttpError(
          409,
          "OWNERSHIP_INVARIANT",
          "Workspace harus memiliki tepat satu owner",
        );
      }

      // Aksi berisiko: audit berada di transaksi yang sama.
      await writeAudit(
        {
          tenantId: input.ctx.tenantId,
          actorType: "USER",
          actorUserId: input.ctx.userId,
          actorMemberId: input.ctx.memberId,
          action: "ownership.transfer",
          resourceType: "member",
          resourceId: target.id,
          metadata: {
            fromMemberId: input.ctx.memberId,
            toMemberId: target.id,
            fromRoleKey: OWNER_ROLE,
            toRoleKey: "WORKSPACE_ADMIN",
            previousTargetRoleKeys: target.roles
              .map((assignment) => assignment.role.key)
              .sort(),
          },
          ip: input.ip ?? null,
          userAgent: input.userAgent ?? null,
        },
        tx,
      );

      return {
        targetId: target.id,
        targetUserId: target.userId,
      };
    });

    // Kedua pihak mengalami perubahan privilege. Cabut sesi lama keduanya.
    await Promise.all([
      revokeAllSessionsForUser(outcome.targetUserId),
      revokeAllSessionsForUser(input.ctx.userId),
    ]);

    return {
      fromMemberId: input.ctx.memberId,
      toMemberId: outcome.targetId,
      ownerRoleKey: OWNER_ROLE,
      formerOwnerRoleKey: "WORKSPACE_ADMIN",
    };
  });
}

export const MEMBER_LIST_DEFAULT_LIMIT = 50;
export const MEMBER_LIST_MAX_LIMIT = 100;

function normalizePaginationValue(
  value: number | undefined,
  fallback: number,
  min: number,
  max: number,
): number {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new HttpError(400, "INVALID_PAGINATION", "Parameter pagination tidak valid");
  }
  return value;
}

export type ListWorkspaceMembersInput = {
  ctx: TenantContext;
  workspaceId: string;
  limit?: number | undefined;
  offset?: number | undefined;
};

export type WorkspaceMemberSummary = {
  id: string;
  status: string;
  joinedAt: string | null;
  officeLocationId: string | null;
  divisionId: string | null;
  positionId: string | null;
  divisionName: string | null;
  positionName: string | null;
  user: { id: string; name: string; email: string };
  roleKeys: string[];
};

export type ListWorkspaceMembersResult = {
  members: WorkspaceMemberSummary[];
  pagination: { limit: number; offset: number; total: number };
};

/**
 * Daftar member tenant aktif. `:workspaceId` hanya klaim; filter tenant tetap
 * berasal dari ctx (extension withTenant menimpanya). Respons memakai
 * allowlist field, bukan objek Prisma mentah.
 */
export async function listWorkspaceMembers(
  input: ListWorkspaceMembersInput,
): Promise<ListWorkspaceMembersResult> {
  assertWorkspaceReadClaim(input.ctx, input.workspaceId);
  const limit = normalizePaginationValue(
    input.limit,
    MEMBER_LIST_DEFAULT_LIMIT,
    1,
    MEMBER_LIST_MAX_LIMIT,
  );
  const offset = normalizePaginationValue(input.offset, 0, 0, Number.MAX_SAFE_INTEGER);

  return withTenant(input.ctx, async (db) => {
    const total = await db.workspaceMember.count();
    const rows = await db.workspaceMember.findMany({
      include: {
        user: { select: { id: true, name: true, email: true } },
        division: { select: { name: true } },
        position: { select: { name: true } },
        roles: { include: { role: { select: { key: true } } } },
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: limit,
      skip: offset,
    });

    return {
      members: rows.map((row) => ({
        id: row.id,
        status: row.status,
        joinedAt: row.joinedAt ? row.joinedAt.toISOString() : null,
        officeLocationId: row.officeLocationId,
        divisionId: row.divisionId,
        positionId: row.positionId,
        divisionName: row.division?.name ?? null,
        positionName: row.position?.name ?? null,
        user: { id: row.user.id, name: row.user.name, email: row.user.email },
        roleKeys: row.roles.map((assignment) => assignment.role.key).sort(),
      })),
      pagination: { limit, offset, total },
    };
  });
}

export function isWorkspaceRole(value: string): value is RoleKey {
  return isRoleKey(value);
}
