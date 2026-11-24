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
import { highestRoleRank } from "./role-policy.js";
import { revokeAllSessionsForUser } from "./session.js";
import { assertEmail, assertName } from "./users.js";
import { assertWorkspaceClaim } from "./workspaces.js";

function normalizeEmployeeStatus(value: unknown, fallback = "ACTIVE"): "ACTIVE" | "INACTIVE" {
  if (value === undefined || value === null || value === "") return fallback as "ACTIVE" | "INACTIVE";
  const status = typeof value === "string" ? value.trim().toUpperCase() : "";
  if (status !== "ACTIVE" && status !== "INACTIVE") {
    throw new HttpError(400, "INVALID_STATUS", "Status karyawan harus ACTIVE atau INACTIVE");
  }
  return status;
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
  status?: string | undefined;
  officeId?: string | null | undefined;
  divisionId?: string | null | undefined;
  positionId?: string | null | undefined;
  shiftId?: string | null | undefined;
  ip?: string | null | undefined;
  userAgent?: string | null | undefined;
};

export type DirectAddMemberResult = {
  memberId: string;
  userId: string;
  name: string;
  email: string;
  status: "ACTIVE" | "INACTIVE";
  roleKey: RoleKey;
  officeId: string | null;
  divisionId: string | null;
  positionId: string | null;
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
  // Data Karyawan selalu membuat akun karyawan standar. Role admin dikelola
  // terpisah di Pengaturan -> Akun Admin agar tidak tercampur dengan onboarding.
  const roleKey: RoleKey = "EMPLOYEE";
  const status = normalizeEmployeeStatus(input.status);
  const officeId = optionalUuid(input.officeId, "INVALID_OFFICE", "Kantor tidak valid");
  const divisionId = optionalUuid(input.divisionId, "INVALID_DIVISION", "Divisi tidak valid");
  const positionId = optionalUuid(input.positionId, "INVALID_POSITION", "Jabatan tidak valid");
  const shiftId = optionalUuid(input.shiftId, "INVALID_SHIFT", "Shift tidak valid");
  if ((officeId || shiftId || divisionId || positionId) && !input.ctx.permissions.includes("member.manage")) {
    throw new HttpError(403, "FORBIDDEN", "Permission data karyawan tidak mencukupi");
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
        if (divisionId) {
          const division = await tx.division.findFirst({
            where: { tenantId: input.ctx.tenantId, id: divisionId },
          });
          if (!division) {
            throw new HttpError(404, "DIVISION_NOT_FOUND", "Divisi tidak ditemukan");
          }
        }
        if (positionId) {
          const position = await tx.position.findFirst({
            where: { tenantId: input.ctx.tenantId, id: positionId },
          });
          if (!position) {
            throw new HttpError(404, "POSITION_NOT_FOUND", "Jabatan tidak ditemukan");
          }
          if (position.divisionId && divisionId && position.divisionId !== divisionId) {
            throw new HttpError(400, "POSITION_DIVISION_MISMATCH", "Jabatan bukan milik divisi tersebut");
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
            status,
            joinedAt: now,
            officeLocationId: officeId,
            divisionId,
            positionId,
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
            metadata: {
              email,
              name,
              roleKey,
              status,
              officeId,
              divisionId,
              positionId,
              shiftId,
            },
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
          status,
          roleKey,
          officeId,
          divisionId,
          positionId,
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

export type UpdateMemberEmployeeInput = {
  ctx: TenantContext;
  workspaceId: string;
  memberId: string;
  name?: string | undefined;
  status?: string | undefined;
  officeLocationId?: string | null | undefined;
  divisionId?: string | null | undefined;
  positionId?: string | null | undefined;
  ip?: string | null | undefined;
  userAgent?: string | null | undefined;
};

export type UpdateMemberEmployeeResult = {
  memberId: string;
  userId: string;
  name: string;
  status: "ACTIVE" | "INACTIVE";
  officeLocationId: string | null;
  divisionId: string | null;
  positionId: string | null;
  sessionsRevoked: number;
};

/** Edit identitas karyawan tanpa menyentuh role akun admin. */
export async function updateMemberEmployee(
  input: UpdateMemberEmployeeInput,
): Promise<UpdateMemberEmployeeResult> {
  assertWorkspaceClaim(input.ctx, input.workspaceId);
  if (!input.ctx.permissions.includes("member.manage")) {
    throw new HttpError(403, "FORBIDDEN", "Permission data karyawan tidak mencukupi");
  }
  if (!isUuid(input.memberId)) {
    throw new HttpError(400, "INVALID_MEMBER", "Member tidak valid");
  }
  if (input.memberId === input.ctx.memberId) {
    throw new HttpError(
      400,
      "SELF_EMPLOYEE_EDIT",
      "Data akun sendiri dikelola melalui Profil & Keamanan",
    );
  }
  const hasChange =
    input.name !== undefined ||
    input.status !== undefined ||
    input.officeLocationId !== undefined ||
    input.divisionId !== undefined ||
    input.positionId !== undefined;
  if (!hasChange) {
    throw new HttpError(400, "INVALID_INPUT", "Minimal satu data karyawan harus diubah");
  }
  const name = input.name === undefined ? undefined : assertName(input.name);
  const status = input.status === undefined ? undefined : normalizeEmployeeStatus(input.status);
  const officeId =
    input.officeLocationId === undefined
      ? undefined
      : optionalUuid(input.officeLocationId, "INVALID_OFFICE", "Kantor tidak valid");
  const divisionId =
    input.divisionId === undefined
      ? undefined
      : optionalUuid(input.divisionId, "INVALID_DIVISION", "Divisi tidak valid");
  const positionId =
    input.positionId === undefined
      ? undefined
      : optionalUuid(input.positionId, "INVALID_POSITION", "Jabatan tidak valid");

  const result = await systemDb().$transaction(async (tx) => {
    const target = await tx.workspaceMember.findFirst({
      where: { tenantId: input.ctx.tenantId, id: input.memberId },
      include: { user: { select: { id: true, name: true } } },
    });
    if (!target) {
      throw new HttpError(404, "MEMBER_NOT_FOUND", "Member tidak ditemukan");
    }
    const finalDivisionId = divisionId === undefined ? target.divisionId : divisionId;
    if (divisionId) {
      const division = await tx.division.findFirst({
        where: { tenantId: input.ctx.tenantId, id: divisionId },
      });
      if (!division) throw new HttpError(404, "DIVISION_NOT_FOUND", "Divisi tidak ditemukan");
    }
    if (positionId) {
      const position = await tx.position.findFirst({
        where: { tenantId: input.ctx.tenantId, id: positionId },
      });
      if (!position) throw new HttpError(404, "POSITION_NOT_FOUND", "Jabatan tidak ditemukan");
      if (position.divisionId && finalDivisionId && position.divisionId !== finalDivisionId) {
        throw new HttpError(400, "POSITION_DIVISION_MISMATCH", "Jabatan bukan milik divisi tersebut");
      }
    }
    if (officeId) {
      const office = await tx.officeLocation.findFirst({
        where: { tenantId: input.ctx.tenantId, id: officeId },
      });
      if (!office) throw new HttpError(404, "OFFICE_NOT_FOUND", "Kantor tidak ditemukan");
    }

    if (name !== undefined) {
      await tx.user.update({ where: { id: target.userId }, data: { name } });
    }
    const updated = await tx.workspaceMember.update({
      where: { tenantId_id: { tenantId: input.ctx.tenantId, id: target.id } },
      data: {
        ...(name === undefined ? {} : {}),
        ...(status === undefined ? {} : { status }),
        ...(officeId === undefined ? {} : { officeLocationId: officeId }),
        ...(divisionId === undefined ? {} : { divisionId }),
        ...(positionId === undefined ? {} : { positionId }),
      },
    });
    await writeAudit(
      {
        tenantId: input.ctx.tenantId,
        actorType: "USER",
        actorUserId: input.ctx.userId,
        actorMemberId: input.ctx.memberId,
        action: "member.update",
        resourceType: "member",
        resourceId: target.id,
        metadata: {
          status: updated.status,
          officeLocationId: updated.officeLocationId,
          divisionId: updated.divisionId,
          positionId: updated.positionId,
          nameChanged: name !== undefined,
        },
        ip: input.ip ?? null,
        userAgent: input.userAgent ?? null,
      },
      tx,
    );
    return {
      memberId: updated.id,
      userId: target.userId,
      name: name ?? target.user.name,
      status: updated.status as "ACTIVE" | "INACTIVE",
      officeLocationId: updated.officeLocationId,
      divisionId: updated.divisionId,
      positionId: updated.positionId,
    };
  });

  const sessionsRevoked =
    status === "INACTIVE" ? await revokeAllSessionsForUser(result.userId) : 0;
  return { ...result, sessionsRevoked };
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
