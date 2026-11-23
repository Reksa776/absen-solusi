import { randomUUID } from "node:crypto";

import { isUuid, withTenant, writeAudit, type TenantContext } from "@absensi/database";

import { HttpError } from "./http.js";
import { parseReportDay } from "./reports.js";
import { assertWorkspaceReadClaim } from "./workspaces.js";

export const WORK_PROJECTION_PERIODS = ["DAILY", "WEEKLY"] as const;
export const WORK_PROJECTION_STATUSES = [
  "PLANNED",
  "IN_PROGRESS",
  "COMPLETED",
  "BLOCKED",
] as const;
export type WorkProjectionPeriod = (typeof WORK_PROJECTION_PERIODS)[number];
export type WorkProjectionStatus = (typeof WORK_PROJECTION_STATUSES)[number];

export type WorkProjectionSummary = {
  id: string;
  memberId: string;
  memberName: string;
  memberEmail: string;
  divisionName: string | null;
  title: string;
  description: string | null;
  periodType: WorkProjectionPeriod;
  startDate: string;
  endDate: string;
  progress: number;
  status: WorkProjectionStatus;
  blockerNote: string | null;
  reviewNote: string | null;
  reviewedAt: string | null;
  createdAt: string;
};

function assertManage(ctx: TenantContext): void {
  if (
    !ctx.permissions.includes("member.manage") &&
    !ctx.roleKeys.includes("WORKSPACE_OWNER") &&
    !ctx.roleKeys.includes("WORKSPACE_ADMIN")
  ) {
    throw new HttpError(403, "FORBIDDEN", "Permission tidak mencukupi");
  }
}

function parsePeriod(value: unknown): WorkProjectionPeriod {
  if (
    typeof value !== "string" ||
    !(WORK_PROJECTION_PERIODS as readonly string[]).includes(value.toUpperCase())
  ) {
    throw new HttpError(400, "INVALID_PERIOD", "Periode harus DAILY atau WEEKLY");
  }
  return value.toUpperCase() as WorkProjectionPeriod;
}

function parseStatus(value: unknown): WorkProjectionStatus {
  if (
    typeof value !== "string" ||
    !(WORK_PROJECTION_STATUSES as readonly string[]).includes(value.toUpperCase())
  ) {
    throw new HttpError(400, "INVALID_STATUS", "Status proyeksi tidak valid");
  }
  return value.toUpperCase() as WorkProjectionStatus;
}

function optionalText(value: unknown, label: string, max: number): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") {
    throw new HttpError(400, "INVALID_PROJECTION", `${label} tidak valid`);
  }
  const text = value.trim();
  if (text === "") return null;
  if (text.length > max) {
    throw new HttpError(400, "INVALID_PROJECTION", `${label} maksimal ${max} karakter`);
  }
  return text;
}

function day(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function toSummary(row: {
  id: string;
  memberId: string;
  title: string;
  description: string | null;
  periodType: string;
  startDate: Date;
  endDate: Date;
  progress: number;
  status: string;
  blockerNote: string | null;
  reviewNote: string | null;
  reviewedAt: Date | null;
  createdAt: Date;
  member: {
    user: { name: string; email: string };
    division: { name: string } | null;
  };
}): WorkProjectionSummary {
  return {
    id: row.id,
    memberId: row.memberId,
    memberName: row.member.user.name,
    memberEmail: row.member.user.email,
    divisionName: row.member.division?.name ?? null,
    title: row.title,
    description: row.description,
    periodType: row.periodType as WorkProjectionPeriod,
    startDate: day(row.startDate),
    endDate: day(row.endDate),
    progress: row.progress,
    status: row.status as WorkProjectionStatus,
    blockerNote: row.blockerNote,
    reviewNote: row.reviewNote,
    reviewedAt: row.reviewedAt ? row.reviewedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
  };
}

const INCLUDE = {
  member: {
    include: {
      user: { select: { name: true, email: true } },
      division: { select: { name: true } },
    },
  },
} as const;

export async function listMyWorkProjections(input: {
  ctx: TenantContext;
  status?: string | undefined;
}): Promise<WorkProjectionSummary[]> {
  const status = input.status?.trim().toUpperCase();
  const rows = await withTenant(input.ctx, (db) =>
    db.workProjection.findMany({
      where: {
        memberId: input.ctx.memberId,
        ...(status && status !== "ALL" ? { status } : {}),
      },
      include: INCLUDE,
      orderBy: [{ startDate: "desc" }, { createdAt: "desc" }],
    }),
  );
  return rows.map(toSummary);
}

export async function listWorkspaceWorkProjections(input: {
  ctx: TenantContext;
  workspaceId: string;
  memberId?: string | undefined;
  divisionId?: string | undefined;
  status?: string | undefined;
  from?: string | undefined;
  to?: string | undefined;
}): Promise<WorkProjectionSummary[]> {
  if (!input.ctx.permissions.includes("attendance.read")) {
    throw new HttpError(403, "FORBIDDEN", "Permission tidak mencukupi");
  }
  assertWorkspaceReadClaim(input.ctx, input.workspaceId);
  if (input.memberId && !isUuid(input.memberId)) {
    throw new HttpError(400, "INVALID_MEMBER", "Member tidak valid");
  }
  const status = input.status?.trim().toUpperCase();
  if (status && status !== "ALL" && !(WORK_PROJECTION_STATUSES as readonly string[]).includes(status)) {
    throw new HttpError(400, "INVALID_STATUS", "Status proyeksi tidak valid");
  }
  const from = input.from ? parseReportDay(input.from, "from") : undefined;
  const to = input.to ? parseReportDay(input.to, "to") : undefined;
  const rows = await withTenant(input.ctx, (db) =>
    db.workProjection.findMany({
      where: {
        ...(input.memberId ? { memberId: input.memberId } : {}),
        ...(input.divisionId ? { member: { divisionId: input.divisionId } } : {}),
        ...(status && status !== "ALL" ? { status } : {}),
        ...(from || to
          ? {
              startDate: {
                ...(to ? { lte: to } : {}),
              },
              endDate: {
                ...(from ? { gte: from } : {}),
              },
            }
          : {}),
      },
      include: INCLUDE,
      orderBy: [{ startDate: "desc" }, { createdAt: "desc" }],
      take: 300,
    }),
  );
  return rows.map(toSummary);
}

export async function createWorkProjection(input: {
  ctx: TenantContext;
  body: Record<string, unknown>;
  ip?: string | null;
  userAgent?: string | null;
}): Promise<WorkProjectionSummary> {
  const title = typeof input.body.title === "string" ? input.body.title.trim() : "";
  if (title.length < 3 || title.length > 160) {
    throw new HttpError(400, "INVALID_TITLE", "Judul proyeksi 3–160 karakter");
  }
  const description = optionalText(input.body.description, "Deskripsi", 1000);
  const periodType = parsePeriod(input.body.periodType);
  const startDate = parseReportDay(
    typeof input.body.startDate === "string" ? input.body.startDate : "",
    "startDate",
  );
  const endDate = parseReportDay(
    typeof input.body.endDate === "string" ? input.body.endDate : "",
    "endDate",
  );
  if (endDate.getTime() < startDate.getTime()) {
    throw new HttpError(400, "INVALID_DATE_RANGE", "Tanggal selesai tidak boleh sebelum mulai");
  }
  if ((endDate.getTime() - startDate.getTime()) / 86_400_000 > 31) {
    throw new HttpError(400, "INVALID_DATE_RANGE", "Proyeksi maksimal 32 hari");
  }
  const progress = Number(input.body.progress ?? 0);
  if (!Number.isInteger(progress) || progress < 0 || progress > 100) {
    throw new HttpError(400, "INVALID_PROGRESS", "Progres harus 0–100");
  }
  const status = input.body.status
    ? parseStatus(input.body.status)
    : progress >= 100
      ? "COMPLETED"
      : progress > 0
        ? "IN_PROGRESS"
        : "PLANNED";
  const blockerNote = optionalText(input.body.blockerNote, "Catatan kendala", 1000);
  if (status === "BLOCKED" && !blockerNote) {
    throw new HttpError(400, "BLOCKER_REQUIRED", "Catatan kendala wajib diisi untuk status BLOCKED");
  }
  const id = randomUUID();
  const created = await withTenant(input.ctx, (db) =>
    db.$transaction(async (tx) => {
      const row = await tx.workProjection.create({
        data: {
          id,
          tenantId: input.ctx.tenantId,
          memberId: input.ctx.memberId,
          title,
          description,
          periodType,
          startDate,
          endDate,
          progress,
          status,
          blockerNote,
          createdByMemberId: input.ctx.memberId,
        },
        include: INCLUDE,
      });
      await writeAudit(
        {
          tenantId: input.ctx.tenantId,
          actorType: "USER",
          actorUserId: input.ctx.userId,
          actorMemberId: input.ctx.memberId,
          action: "work_projection.create",
          resourceType: "work_projection",
          resourceId: id,
          metadata: {
            periodType,
            startDate: day(startDate),
            endDate: day(endDate),
            progress,
            status,
          },
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

export async function updateWorkProjection(input: {
  ctx: TenantContext;
  projectionId: string;
  body: Record<string, unknown>;
  ip?: string | null;
  userAgent?: string | null;
}): Promise<WorkProjectionSummary> {
  if (!isUuid(input.projectionId)) {
    throw new HttpError(404, "PROJECTION_NOT_FOUND", "Proyeksi tidak ditemukan");
  }
  const updated = await withTenant(input.ctx, (db) =>
    db.$transaction(async (tx) => {
      const existing = await tx.workProjection.findFirst({
        where: { id: input.projectionId, memberId: input.ctx.memberId },
      });
      if (!existing) {
        throw new HttpError(404, "PROJECTION_NOT_FOUND", "Proyeksi tidak ditemukan");
      }
      const progress =
        input.body.progress === undefined
          ? existing.progress
          : Number(input.body.progress);
      if (!Number.isInteger(progress) || progress < 0 || progress > 100) {
        throw new HttpError(400, "INVALID_PROGRESS", "Progres harus 0–100");
      }
      const blockerNote =
        input.body.blockerNote === undefined
          ? existing.blockerNote
          : optionalText(input.body.blockerNote, "Catatan kendala", 1000);
      let status = input.body.status
        ? parseStatus(input.body.status)
        : progress >= 100
          ? "COMPLETED"
          : progress > 0
            ? "IN_PROGRESS"
            : existing.status;
      if (status === "BLOCKED" && !blockerNote) {
        throw new HttpError(400, "BLOCKER_REQUIRED", "Catatan kendala wajib diisi");
      }
      if (progress >= 100) status = "COMPLETED";
      const row = await tx.workProjection.update({
        where: { tenantId_id: { tenantId: input.ctx.tenantId, id: existing.id } },
        data: { progress, status, blockerNote },
        include: INCLUDE,
      });
      await writeAudit(
        {
          tenantId: input.ctx.tenantId,
          actorType: "USER",
          actorUserId: input.ctx.userId,
          actorMemberId: input.ctx.memberId,
          action: "work_projection.update",
          resourceType: "work_projection",
          resourceId: row.id,
          metadata: { progress, status, hasBlocker: Boolean(blockerNote) },
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

export async function reviewWorkProjection(input: {
  ctx: TenantContext;
  workspaceId: string;
  projectionId: string;
  reviewNote: unknown;
  ip?: string | null;
  userAgent?: string | null;
}): Promise<WorkProjectionSummary> {
  assertManage(input.ctx);
  assertWorkspaceReadClaim(input.ctx, input.workspaceId);
  if (!isUuid(input.projectionId)) {
    throw new HttpError(404, "PROJECTION_NOT_FOUND", "Proyeksi tidak ditemukan");
  }
  const reviewNote = optionalText(input.reviewNote, "Catatan review", 1000);
  if (!reviewNote || reviewNote.length < 3) {
    throw new HttpError(400, "REVIEW_NOTE_REQUIRED", "Catatan review minimal 3 karakter");
  }
  const updated = await withTenant(input.ctx, (db) =>
    db.$transaction(async (tx) => {
      const existing = await tx.workProjection.findFirst({
        where: { id: input.projectionId },
      });
      if (!existing) {
        throw new HttpError(404, "PROJECTION_NOT_FOUND", "Proyeksi tidak ditemukan");
      }
      const row = await tx.workProjection.update({
        where: { tenantId_id: { tenantId: input.ctx.tenantId, id: existing.id } },
        data: {
          reviewNote,
          reviewedByMemberId: input.ctx.memberId,
          reviewedAt: new Date(),
        },
        include: INCLUDE,
      });
      await writeAudit(
        {
          tenantId: input.ctx.tenantId,
          actorType: "USER",
          actorUserId: input.ctx.userId,
          actorMemberId: input.ctx.memberId,
          action: "work_projection.review",
          resourceType: "work_projection",
          resourceId: row.id,
          metadata: { memberId: row.memberId, progress: row.progress, status: row.status },
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
