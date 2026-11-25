import { randomUUID } from "node:crypto";

import { isUuid, withTenant, writeAudit, type TenantContext } from "@absensi/database";

import { HttpError } from "./http.js";
import { createInAppNotification } from "./inbox.js";
import { parseReportDay, startOfUtcDay } from "./reports.js";
import { assertWorkspaceReadClaim } from "./workspaces.js";
import { parseStatus } from "./overtime.js";

export const WFH_REASON_MIN_LENGTH = 10;
export const WFH_REASON_MAX_LENGTH = 1000;

export type WfhSummary = {
  id: string;
  memberId: string;
  memberName: string;
  memberDivision: string | null;
  memberPosition: string | null;
  date: string;
  reason: string;
  status: string;
  reviewedAt: string | null;
  rejectionReason: string | null;
  createdAt: string;
};

function assertReview(ctx: TenantContext): void {
  if (!ctx.permissions.includes("correction.review")) {
    throw new HttpError(403, "FORBIDDEN", "Permission tidak mencukupi");
  }
}

function toSummary(row: {
  id: string;
  memberId: string;
  date: Date;
  reason: string;
  status: string;
  reviewedAt: Date | null;
  rejectionReason: string | null;
  createdAt: Date;
  member: {
    user: { name: string };
    division: { name: string } | null;
    position: { name: string } | null;
  };
}): WfhSummary {
  return {
    id: row.id,
    memberId: row.memberId,
    memberName: row.member.user.name,
    memberDivision: row.member.division?.name ?? null,
    memberPosition: row.member.position?.name ?? null,
    date: row.date.toISOString().slice(0, 10),
    reason: row.reason,
    status: row.status,
    reviewedAt: row.reviewedAt ? row.reviewedAt.toISOString() : null,
    rejectionReason: row.rejectionReason,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function submitWfh(input: {
  ctx: TenantContext;
  body: Record<string, unknown>;
  ip?: string | null;
  userAgent?: string | null;
  now?: Date;
}): Promise<WfhSummary> {
  const date = parseReportDay(
    typeof input.body.date === "string" ? input.body.date : "",
    "date",
  );
  if (date.getTime() < startOfUtcDay(input.now ?? new Date()).getTime()) {
    throw new HttpError(400, "INVALID_DATE", "Tanggal WFH tidak boleh di masa lalu");
  }
  const reason =
    typeof input.body.reason === "string" ? input.body.reason.trim() : "";
  if (reason.length < WFH_REASON_MIN_LENGTH || reason.length > WFH_REASON_MAX_LENGTH) {
    throw new HttpError(
      400,
      "INVALID_REASON",
      `Alasan WFH ${WFH_REASON_MIN_LENGTH}-${WFH_REASON_MAX_LENGTH} karakter`,
    );
  }

  const created = await withTenant(input.ctx, (db) =>
    db.$transaction(async (tx) => {
      const duplicate = await tx.wfhRequest.findFirst({
        where: {
          memberId: input.ctx.memberId,
          date,
          status: { in: ["PENDING", "APPROVED"] },
        },
        select: { id: true },
      });
      if (duplicate) {
        throw new HttpError(409, "WFH_EXISTS", "Sudah ada pengajuan WFH pada tanggal tersebut");
      }
      const row = await tx.wfhRequest.create({
        data: {
          id: randomUUID(),
          tenantId: input.ctx.tenantId,
          memberId: input.ctx.memberId,
          date,
          reason,
        },
        include: {
          member: {
            include: {
              user: { select: { name: true } },
              division: { select: { name: true } },
              position: { select: { name: true } },
            },
          },
        },
      });
      await writeAudit(
        {
          tenantId: input.ctx.tenantId,
          actorType: "USER",
          actorUserId: input.ctx.userId,
          actorMemberId: input.ctx.memberId,
          action: "wfh.request",
          resourceType: "wfh_request",
          resourceId: row.id,
          metadata: { date: date.toISOString().slice(0, 10) },
          ip: input.ip ?? null,
          userAgent: input.userAgent ?? null,
        },
        tx,
      );
      return row;
    }),
  );
  return toSummary(created);
}

export async function listMyWfh(input: {
  ctx: TenantContext;
  status?: string | undefined;
}): Promise<WfhSummary[]> {
  const status = parseStatus(input.status);
  const rows = await withTenant(input.ctx, (db) =>
    db.wfhRequest.findMany({
      where: { memberId: input.ctx.memberId, ...(status ? { status } : {}) },
      include: {
        member: {
          include: {
            user: { select: { name: true } },
            division: { select: { name: true } },
            position: { select: { name: true } },
          },
        },
      },
      orderBy: [{ date: "desc" }, { createdAt: "desc" }],
    }),
  );
  return rows.map(toSummary);
}

export async function listWorkspaceWfh(input: {
  ctx: TenantContext;
  workspaceId: string;
  status?: string | undefined;
  memberId?: string | undefined;
}): Promise<WfhSummary[]> {
  assertReview(input.ctx);
  assertWorkspaceReadClaim(input.ctx, input.workspaceId);
  if (input.memberId && !isUuid(input.memberId)) {
    throw new HttpError(400, "INVALID_MEMBER", "Member tidak valid");
  }
  const status = parseStatus(input.status);
  const rows = await withTenant(input.ctx, (db) =>
    db.wfhRequest.findMany({
      where: {
        ...(status ? { status } : {}),
        ...(input.memberId ? { memberId: input.memberId } : {}),
      },
      include: {
        member: {
          include: {
            user: { select: { name: true } },
            division: { select: { name: true } },
            position: { select: { name: true } },
          },
        },
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: 100,
    }),
  );
  return rows.map(toSummary);
}

export async function reviewWfh(input: {
  ctx: TenantContext;
  wfhId: string;
  action: string;
  rejectionReason?: string | undefined;
  ip?: string | null;
  userAgent?: string | null;
  now?: Date;
}): Promise<WfhSummary> {
  assertReview(input.ctx);
  if (!isUuid(input.wfhId)) {
    throw new HttpError(400, "INVALID_REQUEST", "Pengajuan WFH tidak valid");
  }
  const action = input.action.trim().toUpperCase();
  if (action !== "APPROVE" && action !== "REJECT") {
    throw new HttpError(400, "INVALID_ACTION", "Action harus APPROVE atau REJECT");
  }
  const rejectionReason =
    typeof input.rejectionReason === "string" ? input.rejectionReason.trim() : "";
  if (action === "REJECT" && rejectionReason.length < 5) {
    throw new HttpError(400, "INVALID_REJECTION_REASON", "Alasan penolakan wajib diisi");
  }

  const updated = await withTenant(input.ctx, (db) =>
    db.$transaction(async (tx) => {
      const existing = await tx.wfhRequest.findFirst({
        where: { id: input.wfhId },
        include: {
          member: {
            include: {
              user: { select: { name: true } },
              division: { select: { name: true } },
              position: { select: { name: true } },
            },
          },
        },
      });
      if (!existing) {
        throw new HttpError(404, "WFH_NOT_FOUND", "Pengajuan WFH tidak ditemukan");
      }
      if (existing.status !== "PENDING") {
        throw new HttpError(409, "ALREADY_REVIEWED", "Pengajuan sudah direview");
      }
      const row = await tx.wfhRequest.update({
        where: { tenantId_id: { tenantId: input.ctx.tenantId, id: existing.id } },
        data: {
          status: action === "APPROVE" ? "APPROVED" : "REJECTED",
          reviewedByMemberId: input.ctx.memberId,
          reviewedAt: input.now ?? new Date(),
          rejectionReason: action === "REJECT" ? rejectionReason : null,
        },
        include: {
          member: {
            include: {
              user: { select: { name: true } },
              division: { select: { name: true } },
              position: { select: { name: true } },
            },
          },
        },
      });
      const dateLabel = existing.date.toISOString().slice(0, 10);
      await createInAppNotification(tx, {
        tenantId: input.ctx.tenantId,
        memberId: existing.memberId,
        type: action === "APPROVE" ? "WFH_APPROVED" : "WFH_REJECTED",
        title:
          action === "APPROVE"
            ? `WFH ${dateLabel} disetujui`
            : `WFH ${dateLabel} ditolak`,
        body:
          action === "APPROVE"
            ? `Pengajuan WFH tanggal ${dateLabel} disetujui. Absensi pada tanggal tersebut tidak terkena geofence.`
            : `Pengajuan WFH tanggal ${dateLabel} ditolak. Catatan admin: ${rejectionReason}`,
        linkUrl: `/workspaces/${input.ctx.tenantId}/wfh`,
      });

      await writeAudit(
        {
          tenantId: input.ctx.tenantId,
          actorType: "USER",
          actorUserId: input.ctx.userId,
          actorMemberId: input.ctx.memberId,
          action: action === "APPROVE" ? "wfh.approve" : "wfh.reject",
          resourceType: "wfh_request",
          resourceId: existing.id,
          metadata: {
            memberId: existing.memberId,
            status: row.status,
            ...(action === "REJECT" ? { rejectionReason } : {}),
          },
          ip: input.ip ?? null,
          userAgent: input.userAgent ?? null,
        },
        tx,
      );
      return row;
    }),
  );
  return toSummary(updated);
}
