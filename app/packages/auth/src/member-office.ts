import { isUuid, writeAudit, withTenant, type TenantContext } from "@absensi/database";

import { HttpError } from "./http.js";
import { assertWorkspaceReadClaim } from "./workspaces.js";

export type AssignMemberOfficeInput = {
  ctx: TenantContext;
  workspaceId: string;
  memberId: string;
  officeLocationId: string | null;
  ip?: string | null;
  userAgent?: string | null;
};

export type AssignedOfficeResult = {
  memberId: string;
  officeLocationId: string | null;
};

/**
 * Penugasan kantor bersifat opsional. Tanpa penugasan, absensi memilih kantor
 * aktif terdekat; dengan penugasan, hanya kantor itu yang sah.
 */
export async function assignMemberOffice(
  input: AssignMemberOfficeInput,
): Promise<AssignedOfficeResult> {
  if (!input.ctx.permissions.includes("office.manage")) {
    throw new HttpError(403, "FORBIDDEN", "Permission tidak mencukupi");
  }
  assertWorkspaceReadClaim(input.ctx, input.workspaceId);
  if (!isUuid(input.memberId)) {
    throw new HttpError(400, "INVALID_MEMBER", "Member tidak valid");
  }
  if (input.officeLocationId !== null && !isUuid(input.officeLocationId)) {
    throw new HttpError(400, "INVALID_OFFICE", "Kantor tidak valid");
  }

  return withTenant(input.ctx, async (db) =>
    db.$transaction(async (tx) => {
      const member = await tx.workspaceMember.findFirst({
        where: { id: input.memberId, status: "ACTIVE" },
        select: { id: true, officeLocationId: true },
      });
      if (!member) {
        throw new HttpError(404, "MEMBER_NOT_FOUND", "Member tidak ditemukan");
      }
      if (input.officeLocationId) {
        const office = await tx.officeLocation.findFirst({
          where: { id: input.officeLocationId, isActive: true },
          select: { id: true },
        });
        if (!office) {
          throw new HttpError(404, "OFFICE_NOT_FOUND", "Kantor aktif tidak ditemukan");
        }
      }

      await tx.workspaceMember.update({
        where: {
          tenantId_id: { tenantId: input.ctx.tenantId, id: member.id },
        },
        data: { officeLocationId: input.officeLocationId },
      });
      await writeAudit(
        {
          tenantId: input.ctx.tenantId,
          actorType: "USER",
          actorUserId: input.ctx.userId,
          actorMemberId: input.ctx.memberId,
          action: "member.office_assign",
          resourceType: "member",
          resourceId: member.id,
          metadata: {
            from: member.officeLocationId,
            to: input.officeLocationId,
          },
          ip: input.ip ?? null,
          userAgent: input.userAgent ?? null,
        },
        tx,
      );
      return { memberId: member.id, officeLocationId: input.officeLocationId };
    }),
  );
}
