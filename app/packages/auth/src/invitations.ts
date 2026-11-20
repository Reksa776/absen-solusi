import { createHash, randomUUID } from "node:crypto";

import { hashIp, systemDb, writeAudit } from "@absensi/database";

import { HttpError } from "./http.js";
import { hashPassword } from "./password.js";
import { assertName } from "./users.js";

export const INVITATION_ACCEPT_ACTION = "member.accept_invite";

export type AcceptInvitationInput = {
  token: string;
  authenticatedUserId?: string | null | undefined;
  name?: string | undefined;
  password?: string | undefined;
  ip?: string | null | undefined;
  userAgent?: string | null | undefined;
  now?: Date | undefined;
};

export type AcceptInvitationResult = {
  workspace: { id: string; name: string; slug: string };
  userId: string;
  memberId: string;
  roleKey: string;
  invitationId: string;
};

/**
 * Terima undangan berdasarkan token mentah. Token hanya dibandingkan lewat
 * SHA-256; status PENDING diklaim secara atomik sehingga token yang sama tidak
 * dapat dipakai dua kali.
 *
 * Existing user wajib sudah login dan email sesi harus sama dengan email
 * undangan. User baru hanya dapat dibuat lewat token ini dengan name/password.
 */
export async function acceptInvitation(
  input: AcceptInvitationInput,
): Promise<AcceptInvitationResult> {
  const token = input.token.trim();
  if (!token || token.length > 512) {
    throw new HttpError(400, "INVALID_INVITATION_TOKEN", "Token undangan tidak valid");
  }
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const now = input.now ?? new Date();

  // SYSTEM: token undangan tidak membawa tenant context sampai hash tervalidasi.
  const db = systemDb();
  const invitation = await db.workspaceInvitation.findUnique({
    where: { tokenHash },
    include: {
      workspace: { select: { id: true, name: true, slug: true, status: true } },
      role: { select: { key: true } },
    },
  });
  if (!invitation) {
    throw new HttpError(404, "INVITATION_NOT_FOUND", "Undangan tidak ditemukan");
  }
  if (invitation.status !== "PENDING") {
    throw new HttpError(409, "INVITATION_USED", "Undangan sudah digunakan atau dicabut");
  }
  if (invitation.expiresAt.getTime() <= now.getTime()) {
    throw new HttpError(410, "INVITATION_EXPIRED", "Undangan sudah kedaluwarsa");
  }
  if (invitation.workspace.status !== "ACTIVE") {
    throw new HttpError(409, "WORKSPACE_INACTIVE", "Workspace tidak aktif");
  }

  let userId: string;
  let passwordHash: string | null = null;
  let displayName: string;
  const existingUser = await db.user.findUnique({ where: { email: invitation.email } });

  if (input.authenticatedUserId) {
    const authenticatedUser = await db.user.findUnique({
      where: { id: input.authenticatedUserId },
    });
    if (!authenticatedUser || authenticatedUser.status !== "ACTIVE") {
      throw new HttpError(401, "UNAUTHENTICATED", "Sesi tidak valid");
    }
    if (authenticatedUser.email.toLowerCase() !== invitation.email.toLowerCase()) {
      throw new HttpError(
        403,
        "INVITATION_EMAIL_MISMATCH",
        "Email sesi tidak sama dengan email undangan",
      );
    }
    userId = authenticatedUser.id;
    displayName = authenticatedUser.name;
  } else if (existingUser) {
    // Jangan pernah membuat sesi atau mengubah akun existing hanya dengan token.
    throw new HttpError(
      401,
      "LOGIN_REQUIRED",
      "Akun untuk email ini sudah ada; login terlebih dahulu untuk menerima undangan",
    );
  } else {
    if (!input.name || !input.password) {
      throw new HttpError(
        400,
        "ACCOUNT_DETAILS_REQUIRED",
        "name dan password wajib untuk membuat akun baru dari undangan",
      );
    }
    displayName = assertName(input.name);
    passwordHash = await hashPassword(input.password);
    userId = randomUUID();
  }

  try {
    return await db.$transaction(async (tx) => {
      // Klaim atomik: hanya satu request yang boleh mengubah PENDING → ACCEPTED.
      const claimed = await tx.workspaceInvitation.updateMany({
        where: { id: invitation.id, status: "PENDING", expiresAt: { gt: now } },
        data: { status: "ACCEPTED", acceptedAt: now },
      });
      if (claimed.count !== 1) {
        throw new HttpError(409, "INVITATION_USED", "Undangan sudah digunakan atau kedaluwarsa");
      }

      if (passwordHash) {
        await tx.user.create({
          data: {
            id: userId,
            email: invitation.email,
            passwordHash,
            name: displayName,
            status: "ACTIVE",
          },
        });
      }

      const existingMembership = await tx.workspaceMember.findUnique({
        where: { tenantId_userId: { tenantId: invitation.tenantId, userId } },
      });
      let memberId: string;
      if (existingMembership) {
        if (existingMembership.status === "ACTIVE") {
          throw new HttpError(409, "ALREADY_MEMBER", "Email sudah menjadi member workspace");
        }
        memberId = existingMembership.id;
        await tx.workspaceMember.update({
          where: { id: memberId },
          data: { status: "ACTIVE", joinedAt: now },
        });
      } else {
        memberId = randomUUID();
        await tx.workspaceMember.create({
          data: {
            id: memberId,
            tenantId: invitation.tenantId,
            userId,
            status: "ACTIVE",
            joinedAt: now,
          },
        });
      }

      await tx.memberRole.upsert({
        where: {
          tenantId_memberId_roleId: {
            tenantId: invitation.tenantId,
            memberId,
            roleId: invitation.roleId,
          },
        },
        create: {
          tenantId: invitation.tenantId,
          memberId,
          roleId: invitation.roleId,
        },
        update: {},
      });

      // Audit ikut transaksi: kegagalan audit membatalkan seluruh penerimaan.
      await writeAudit(
        {
          tenantId: invitation.tenantId,
          actorType: "USER",
          actorUserId: userId,
          actorMemberId: memberId,
          action: INVITATION_ACCEPT_ACTION,
          resourceType: "member",
          resourceId: memberId,
          metadata: {
            invitationId: invitation.id,
            email: invitation.email,
            roleKey: invitation.role.key,
          },
          ip: input.ip ?? null,
          userAgent: input.userAgent ?? null,
        },
        tx,
      );

      return {
        workspace: {
          id: invitation.workspace.id,
          name: invitation.workspace.name,
          slug: invitation.workspace.slug,
        },
        userId,
        memberId,
        roleKey: invitation.role.key,
        invitationId: invitation.id,
      };
    });
  } catch (error) {
    // Unique race pada membership/role atau klaim token yang kalah.
    if (error instanceof HttpError) throw error;
    if (typeof error === "object" && error !== null && "code" in error) {
      const code = (error as { code?: unknown }).code;
      if (code === "P2002") {
        throw new HttpError(409, "ALREADY_MEMBER", "Email sudah menjadi member workspace");
      }
    }
    throw error;
  }
}

/** Hash IP tersedia di package database; diekspor ulang untuk test audit route. */
export { hashIp };
