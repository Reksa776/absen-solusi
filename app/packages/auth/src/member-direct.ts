import { randomUUID } from "node:crypto";

import {
  isUuid,
  systemDb,
  writeAudit,
  type TenantContext,
} from "@absensi/database";
import type { RoleKey } from "@absensi/permissions";

import { HttpError } from "./http.js";
import { hashPassword } from "./password.js";
import { evaluateInvitationRole, highestRoleRank } from "./role-policy.js";
import { revokeAllSessionsForUser } from "./session.js";
import { assertEmail, assertName, assertRoleKey } from "./users.js";
import { assertWorkspaceClaim } from "./workspaces.js";

function assertSecurityDecision(
  decision: ReturnType<typeof evaluateInvitationRole>,
): void {
  if (!decision.allowed) {
    throw new HttpError(decision.status, decision.code, decision.message);
  }
}

function optionalUuid(value: string | null | undefined, code: string, message: string): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (!isUuid(value)) throw new HttpError(400, code, message);
  return value;
}

export type DirectAddMemberInput = {
  ctx: TenantContext;
  workspaceId: string;
  name: string;
  email: string;
  password: string;
  role?: string | undefined;
  officeId?: string | null | undefined;
  shiftId?: string | null | undefined;
  ip?: string | null | undefined;
  userAgent?: string | null | undefined;
};

export type DirectAddMemberResult = {
  memberId: string;
  userId: string;
  name: string;
  email: string;
  status: "ACTIVE";
  roleKey: RoleKey;
  officeId: string | null;
  shiftId: string | null;
};

/**
 * Admin-first onboarding: user + membership + role + optional office/shift are
 * created atomically. There is no invitation token or email step.
 */
export async function directAddMember(
  input: DirectAddMemberInput,
): Promise<DirectAddMemberResult> {
  assertWorkspaceClaim(input.ctx, input.workspaceId);
  const name = assertName(input.name);
  const email = assertEmail(input.email);
  const roleKey = assertRoleKey(input.role ?? "EMPLOYEE");
  assertSecurityDecision(
    evaluateInvitationRole({ actorRoleKeys: input.ctx.roleKeys, roleKey }),
  );
  const officeId = optionalUuid(input.officeId, "INVALID_OFFICE", "Kantor tidak valid");
  const shiftId = optionalUuid(input.shiftId, "INVALID_SHIFT", "Shift tidak valid");
  if ((officeId || shiftId) && !input.ctx.permissions.includes("office.manage")) {
    throw new HttpError(403, "FORBIDDEN", "Permission kantor tidak mencukupi");
  }

  const passwordHash = await hashPassword(input.password);
  const userId = randomUUID();
  const memberId = randomUUID();
  const now = new Date();

  try {
    // User is a global platform model. This cross-tenant operation therefore
    // uses an explicit tenantId in every tenant-scoped read/write inside one
    // system transaction, matching the invitation acceptance pattern.
    return await systemDb().$transaction(async (tx) => {
        const role = await tx.role.findFirst({
          where: { tenantId: input.ctx.tenantId, key: roleKey },
        });
        if (!role) {
          throw new HttpError(400, "INVALID_ROLE", "Role tidak tersedia di workspace ini");
        }

        const existingUser = await tx.user.findUnique({ where: { email } });
        if (existingUser) {
          throw new HttpError(
            409,
            "EMAIL_ALREADY_EXISTS",
            "Email sudah terdaftar. Gunakan email lain atau reset password akun tersebut.",
          );
        }

        if (officeId) {
          const office = await tx.officeLocation.findFirst({
            where: { tenantId: input.ctx.tenantId, id: officeId, isActive: true },
          });
          if (!office) {
            throw new HttpError(404, "OFFICE_NOT_FOUND", "Kantor aktif tidak ditemukan");
          }
        }
        if (shiftId) {
          const shift = await tx.workShift.findFirst({
            where: { tenantId: input.ctx.tenantId, id: shiftId, isActive: true },
          });
          if (!shift) {
            throw new HttpError(404, "SHIFT_NOT_FOUND", "Shift aktif tidak ditemukan");
          }
        }

        await tx.user.create({
          data: {
            id: userId,
            email,
            passwordHash,
            name,
            status: "ACTIVE",
          },
        });
        await tx.workspaceMember.create({
          data: {
            id: memberId,
            tenantId: input.ctx.tenantId,
            userId,
            status: "ACTIVE",
            joinedAt: now,
            officeLocationId: officeId,
          },
        });
        await tx.memberRole.create({
          data: {
            tenantId: input.ctx.tenantId,
            memberId,
            roleId: role.id,
          },
        });
        if (shiftId) {
          await tx.memberShift.create({
            data: {
              id: randomUUID(),
              tenantId: input.ctx.tenantId,
              memberId,
              shiftId,
              workDate: null,
            },
          });
        }

        await writeAudit(
          {
            tenantId: input.ctx.tenantId,
            actorType: "USER",
            actorUserId: input.ctx.userId,
            actorMemberId: input.ctx.memberId,
            action: "member.direct_create",
            resourceType: "member",
            resourceId: memberId,
            metadata: { email, name, roleKey, officeId, shiftId },
            ip: input.ip ?? null,
            userAgent: input.userAgent ?? null,
          },
          tx,
        );

        return {
          memberId,
          userId,
          name,
          email,
          status: "ACTIVE" as const,
          roleKey,
          officeId,
          shiftId,
        };
    });
  } catch (error) {
    if (
      error instanceof HttpError === false &&
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (error as { code?: unknown }).code === "P2002"
    ) {
      throw new HttpError(409, "EMAIL_ALREADY_EXISTS", "Email sudah terdaftar");
    }
    throw error;
  }
}

export type ResetMemberPasswordInput = {
  ctx: TenantContext;
  workspaceId: string;
  memberId: string;
  password: string;
  ip?: string | null | undefined;
  userAgent?: string | null | undefined;
};

export type ResetMemberPasswordResult = {
  memberId: string;
  userId: string;
  email: string;
  sessionsRevoked: number;
};

/**
 * Password reset is direct and invalidates every existing session of the target.
 * A manager may only reset a member whose highest role is below their own.
 */
export async function resetMemberPassword(
  input: ResetMemberPasswordInput,
): Promise<ResetMemberPasswordResult> {
  assertWorkspaceClaim(input.ctx, input.workspaceId);
  if (!isUuid(input.memberId)) {
    throw new HttpError(400, "INVALID_MEMBER", "Member tidak valid");
  }
  if (input.memberId === input.ctx.memberId) {
    throw new HttpError(
      400,
      "SELF_PASSWORD_RESET",
      "Gunakan menu keamanan akun untuk mengganti password sendiri",
    );
  }
  const passwordHash = await hashPassword(input.password);

  // User is global, so load the membership with an explicit tenant filter.
  const target = await systemDb().workspaceMember.findFirst({
    where: {
      tenantId: input.ctx.tenantId,
      id: input.memberId,
      status: "ACTIVE",
    },
    include: {
      user: { select: { id: true, email: true } },
      roles: { include: { role: { select: { key: true } } } },
    },
  });
  if (!target) {
    throw new HttpError(404, "MEMBER_NOT_FOUND", "Member tidak ditemukan");
  }
  const targetRoleKeys = target.roles.map((assignment) => assignment.role.key);
  if (highestRoleRank(targetRoleKeys) >= highestRoleRank(input.ctx.roleKeys)) {
    throw new HttpError(
      403,
      "ROLE_HIERARCHY_VIOLATION",
      "Tidak dapat mereset password member dengan role setara atau lebih tinggi",
    );
  }

  await systemDb().$transaction(async (tx) => {
      await tx.user.update({
        where: { id: target.userId },
        data: { passwordHash },
      });
      await writeAudit(
        {
          tenantId: input.ctx.tenantId,
          actorType: "USER",
          actorUserId: input.ctx.userId,
          actorMemberId: input.ctx.memberId,
          action: "member.password_reset",
          resourceType: "member",
          resourceId: target.id,
          metadata: { email: target.user.email, roles: targetRoleKeys.sort() },
          ip: input.ip ?? null,
          userAgent: input.userAgent ?? null,
        },
        tx,
      );
  });

  const sessionsRevoked = await revokeAllSessionsForUser(target.userId);
  return {
    memberId: target.id,
    userId: target.userId,
    email: target.user.email,
    sessionsRevoked,
  };
}
