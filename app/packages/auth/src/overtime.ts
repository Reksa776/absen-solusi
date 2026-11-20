import { randomUUID } from "node:crypto";

import { isUuid, withTenant, writeAudit, type TenantContext } from "@absensi/database";

import { HttpError } from "./http.js";
import { createInAppNotification } from "./inbox.js";
import { parseReportDay, startOfUtcDay } from "./reports.js";
import { assertWorkspaceReadClaim } from "./workspaces.js";

export const OVERTIME_REASON_MIN_LENGTH = 10;
export const OVERTIME_REASON_MAX_LENGTH = 1000;
export const REQUEST_STATUSES = ["PENDING", "APPROVED", "REJECTED"] as const;
export type RequestStatus = (typeof REQUEST_STATUSES)[number];
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

export type OvertimeSummary = {
  id: string;
  memberId: string;
  memberName: string;
  date: string;
  startTime: string;
  endTime: string;
  durationMinutes: number;
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

function parseTime(value: unknown, field: string): string {
  if (typeof value !== "string" || !TIME_PATTERN.test(value.trim())) {
    throw new HttpError(400, "INVALID_TIME", `Field ${field} harus berformat HH:MM`);
  }
  return value.trim();
}

function minutes(value: string): number {
  return Number(value.slice(0, 2)) * 60 + Number(value.slice(3, 5));
}

export function parseStatus(value: string | undefined): string | undefined {
  if (value === undefined || value.trim() === "") return undefined;
  const status = value.trim().toUpperCase();
  if (!(REQUEST_STATUSES as readonly string[]).includes(status)) {
    throw new HttpError(400, "INVALID_STATUS", "Status tidak valid");
  }
  return status;
}

function toSummary(row: {
  id: string;
  memberId: string;
  date: Date;
  startTime: string;
  endTime: string;
  durationMinutes: number;
  reason: string;
  status: string;
  reviewedAt: Date | null;
  rejectionReason: string | null;
  createdAt: Date;
  member: { user: { name: string } };
}): OvertimeSummary {
  return {
    id: row.id,
    memberId: row.memberId,
    memberName: row.member.user.name,
    date: row.date.toISOString().slice(0, 10),
    startTime: row.startTime,
    endTime: row.endTime,
    durationMinutes: row.durationMinutes,
    reason: row.reason,
    status: row.status,
    reviewedAt: row.reviewedAt ? row.reviewedAt.toISOString() : null,
    rejectionReason: row.rejectionReason,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function submitOvertime(input: {
  ctx: TenantContext;
  body: Record<string, unknown>;
  ip?: string | null;
  userAgent?: string | null;
  now?: Date;
}): Promise<OvertimeSummary> {
  const date = parseReportDay(
    typeof input.body.date === "string" ? input.body.date : "",
    "date",
  );
  if (date.getTime() > startOfUtcDay(input.now ?? new Date()).getTime()) {
    throw new HttpError(400, "INVALID_DATE", "Lembur tidak boleh di masa depan");
  }
  const startTime = parseTime(input.body.startTime, "startTime");
  const endTime = parseTime(input.body.endTime, "endTime");
  const durationMinutes = minutes(endTime) - minutes(startTime);
  if (durationMinutes <= 0 || durationMinutes > 12 * 60) {
    throw new HttpError(400, "INVALID_DURATION", "Durasi lembur 1-720 menit");
  }
  const reason =
    typeof input.body.reason === "string" ? input.body.reason.trim() : "";
  if (reason.length < OVERTIME_REASON_MIN_LENGTH || reason.length > OVERTIME_REASON_MAX_LENGTH) {
    throw new HttpError(
      400,
      "INVALID_REASON",
      `Alasan lembur ${OVERTIME_REASON_MIN_LENGTH}-${OVERTIME_REASON_MAX_LENGTH} karakter`,
    );
  }

  const created = await withTenant(input.ctx, (db) =>
    db.$transaction(async (tx) => {
      const pending = await tx.overtimeRequest.findFirst({
        where: { memberId: input.ctx.memberId, date, status: "PENDING" },
        select: { id: true },
      });
      if (pending) {
        throw new HttpError(409, "OVERTIME_PENDING", "Sudah ada pengajuan lembur pending");
      }
      const row = await tx.overtimeRequest.create({
        data: {
          id: randomUUID(),
          tenantId: input.ctx.tenantId,
          memberId: input.ctx.memberId,
          date,
          startTime,
          endTime,
          durationMinutes,
          reason,
        },
        include: { member: { include: { user: { select: { name: true } } } } },
      });
      await writeAudit(
        {
          tenantId: input.ctx.tenantId,
          actorType: "USER",
          actorUserId: input.ctx.userId,
          actorMemberId: input.ctx.memberId,
          action: "overtime.request",
          resourceType: "overtime_request",
          resourceId: row.id,
          metadata: { date: date.toISOString().slice(0, 10), durationMinutes },
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

export async function listMyOvertime(input: {
  ctx: TenantContext;
  status?: string | undefined;
}): Promise<OvertimeSummary[]> {
  const status = parseStatus(input.status);
  const rows = await withTenant(input.ctx, (db) =>
    db.overtimeRequest.findMany({
      where: { memberId: input.ctx.memberId, ...(status ? { status } : {}) },
      include: { member: { include: { user: { select: { name: true } } } } },
      orderBy: [{ date: "desc" }, { createdAt: "desc" }],
    }),
  );
  return rows.map(toSummary);
}

export async function listWorkspaceOvertime(input: {
  ctx: TenantContext;
  workspaceId: string;
  status?: string | undefined;
  memberId?: string | undefined;
}): Promise<OvertimeSummary[]> {
  assertReview(input.ctx);
  assertWorkspaceReadClaim(input.ctx, input.workspaceId);
  if (input.memberId && !isUuid(input.memberId)) {
    throw new HttpError(400, "INVALID_MEMBER", "Member tidak valid");
  }
  const status = parseStatus(input.status);
  const rows = await withTenant(input.ctx, (db) =>
    db.overtimeRequest.findMany({
      where: {
        ...(status ? { status } : {}),
        ...(input.memberId ? { memberId: input.memberId } : {}),
      },
      include: { member: { include: { user: { select: { name: true } } } } },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: 100,
    }),
  );
  return rows.map(toSummary);
}

export async function reviewOvertime(input: {
  ctx: TenantContext;
  overtimeId: string;
  action: string;
  rejectionReason?: string | undefined;
  ip?: string | null;
  userAgent?: string | null;
  now?: Date;
}): Promise<OvertimeSummary> {
  assertReview(input.ctx);
  if (!isUuid(input.overtimeId)) {
    throw new HttpError(400, "INVALID_REQUEST", "Pengajuan lembur tidak valid");
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
      const existing = await tx.overtimeRequest.findFirst({
        where: { id: input.overtimeId },
        include: { member: { include: { user: { select: { name: true } } } } },
      });
      if (!existing) {
        throw new HttpError(404, "OVERTIME_NOT_FOUND", "Pengajuan lembur tidak ditemukan");
      }
      if (existing.status !== "PENDING") {
        throw new HttpError(409, "ALREADY_REVIEWED", "Pengajuan sudah direview");
      }
      const row = await tx.overtimeRequest.update({
        where: { tenantId_id: { tenantId: input.ctx.tenantId, id: existing.id } },
        data: {
          status: action === "APPROVE" ? "APPROVED" : "REJECTED",
          reviewedByMemberId: input.ctx.memberId,
          reviewedAt: input.now ?? new Date(),
          rejectionReason: action === "REJECT" ? rejectionReason : null,
        },
        include: { member: { include: { user: { select: { name: true } } } } },
      });
      await createInAppNotification(tx, {
        tenantId: input.ctx.tenantId,
        memberId: existing.memberId,
        type: action === "APPROVE" ? "OVERTIME_APPROVED" : "OVERTIME_REJECTED",
        title: action === "APPROVE" ? "Lembur disetujui" : "Lembur ditolak",
        body:
          action === "APPROVE"
            ? "Pengajuan lembur Anda sudah disetujui."
            : "Pengajuan lembur Anda ditolak. Buka detail untuk alasannya.",
        linkUrl: `/workspaces/${input.ctx.tenantId}/overtime`,
      });

      await writeAudit(
        {
          tenantId: input.ctx.tenantId,
          actorType: "USER",
          actorUserId: input.ctx.userId,
          actorMemberId: input.ctx.memberId,
          action: action === "APPROVE" ? "overtime.approve" : "overtime.reject",
          resourceType: "overtime_request",
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
