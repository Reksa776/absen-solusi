import { randomUUID } from "node:crypto";

import { isUuid, withTenant, writeAudit, type TenantContext } from "@absensi/database";

import { assertApprovalActor, resolveApprovalStep } from "./approvals.js";
import { HttpError } from "./http.js";
import { createInAppNotification } from "./inbox.js";
import { sendPushNotificationToMember } from "./push-notifications.js";
import { parseReportDay } from "./reports.js";
import {
  createWorkPatternRuleIndex,
  isWeekendDay,
  workPatternWorkingDays,
} from "./work-pattern-schedule.js";
import { assertWorkspaceReadClaim } from "./workspaces.js";

export const LEAVE_TYPES = [
  "CUTI_TAHUNAN",
  "CUTI_MELAHIRKAN",
  "CUTI_KHUSUS",
  "LAINNYA",
] as const;
export const LEAVE_STATUSES = ["PENDING", "APPROVED", "REJECTED"] as const;
export const DEFAULT_ANNUAL_QUOTA_DAYS = 12;
export const LEAVE_REASON_MIN_LENGTH = 10;
export const LEAVE_REASON_MAX_LENGTH = 1000;

export type LeaveType = (typeof LEAVE_TYPES)[number];
export type LeaveStatus = (typeof LEAVE_STATUSES)[number];

export type LeavePolicySummary = {
  annualQuotaDays: number;
  updatedAt: string | null;
};

export type LeaveBalanceSummary = {
  year: number;
  entitledDays: number;
  usedDays: number;
  remainingDays: number;
};

export type LeaveRequestSummary = {
  id: string;
  memberId: string;
  memberName: string;
  memberEmail: string;
  divisionName: string | null;
  leaveType: LeaveType;
  startDate: string;
  endDate: string;
  workingDays: number;
  reason: string;
  status: LeaveStatus;
  currentApprovalLevel: number;
  reviewedAt: string | null;
  rejectionReason: string | null;
  createdAt: string;
};

export type LeaveReportRow = {
  memberId: string;
  memberName: string;
  memberEmail: string;
  divisionName: string | null;
  entitledDays: number;
  usedDays: number;
  remainingDays: number;
  pendingDays: number;
};

export type LeaveReport = {
  year: number;
  annualQuotaDays: number;
  rows: LeaveReportRow[];
  totals: {
    entitledDays: number;
    usedDays: number;
    remainingDays: number;
    pendingDays: number;
  };
};

function assertReview(ctx: TenantContext): void {
  if (
    !ctx.permissions.includes("correction.review") &&
    !ctx.permissions.includes("member.manage") &&
    !ctx.roleKeys.includes("WORKSPACE_OWNER") &&
    !ctx.roleKeys.includes("WORKSPACE_ADMIN") &&
    !ctx.roleKeys.includes("HR")
  ) {
    throw new HttpError(403, "FORBIDDEN", "Permission tidak mencukupi");
  }
}

function parseStatus(value: string | undefined): LeaveStatus | undefined {
  if (value === undefined || value.trim() === "") return undefined;
  const status = value.trim().toUpperCase();
  if (!(LEAVE_STATUSES as readonly string[]).includes(status)) {
    throw new HttpError(400, "INVALID_STATUS", "Status cuti tidak valid");
  }
  return status as LeaveStatus;
}

function parseType(value: unknown): LeaveType {
  if (
    typeof value !== "string" ||
    !(LEAVE_TYPES as readonly string[]).includes(value.trim().toUpperCase())
  ) {
    throw new HttpError(400, "INVALID_LEAVE_TYPE", "Jenis cuti tidak valid");
  }
  return value.trim().toUpperCase() as LeaveType;
}

function parseAdminCreateStatus(value: unknown): "PENDING" | "APPROVED" {
  const status = typeof value === "string" ? value.trim().toUpperCase() : "";
  if (status !== "PENDING" && status !== "APPROVED") {
    throw new HttpError(400, "INVALID_STATUS", "Status awal cuti harus PENDING atau APPROVED");
  }
  return status;
}

function parseYear(value: unknown, now: Date): number {
  if (value === undefined || value === null || `${value}`.trim() === "") {
    return now.getUTCFullYear();
  }
  const year = Number(value);
  if (!Number.isInteger(year) || year < 2000 || year > 2100) {
    throw new HttpError(400, "INVALID_YEAR", "Tahun cuti tidak valid");
  }
  return year;
}

function day(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * Hari kerja mengikuti hari aktif Pola Kerja karyawan. Tanpa penugasan,
 * fallback lama Senin-Jumat tetap dipakai. Hari libur workspace selalu dilewati.
 */
export function calculateWorkingDays(
  startDate: Date,
  endDate: Date,
  holidayDates: ReadonlySet<string>,
  workdayNumbers?: ReadonlySet<number> | null,
): number {
  let count = 0;
  for (
    let cursor = startDate.getTime();
    cursor <= endDate.getTime();
    cursor += 86_400_000
  ) {
    const date = new Date(cursor);
    const weekday = date.getUTCDay();
    if (workdayNumbers) {
      if (!workdayNumbers.has(weekday)) continue;
    } else if (isWeekendDay(weekday)) {
      continue;
    }
    if (holidayDates.has(day(date))) continue;
    count += 1;
  }
  return count;
}

export async function leaveHolidayDates(input: {
  ctx: TenantContext;
  startDate: Date;
  endDate: Date;
}): Promise<Set<string>> {
  const rows = await withTenant(input.ctx, (db) =>
    db.workspaceHoliday.findMany({
      where: { date: { gte: input.startDate, lte: input.endDate } },
      select: { date: true },
    }),
  );
  return new Set(rows.map((row) => day(row.date)));
}

function toSummary(row: {
  id: string;
  memberId: string;
  leaveType: string;
  startDate: Date;
  endDate: Date;
  workingDays: number;
  reason: string;
  status: string;
  currentApprovalLevel: number;
  reviewedAt: Date | null;
  rejectionReason: string | null;
  createdAt: Date;
  member: {
    user: { name: string; email: string };
    division: { name: string } | null;
  };
}): LeaveRequestSummary {
  return {
    id: row.id,
    memberId: row.memberId,
    memberName: row.member.user.name,
    memberEmail: row.member.user.email,
    divisionName: row.member.division?.name ?? null,
    leaveType: row.leaveType as LeaveType,
    startDate: day(row.startDate),
    endDate: day(row.endDate),
    workingDays: row.workingDays,
    reason: row.reason,
    status: row.status as LeaveStatus,
    currentApprovalLevel: row.currentApprovalLevel,
    reviewedAt: row.reviewedAt ? row.reviewedAt.toISOString() : null,
    rejectionReason: row.rejectionReason,
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

export async function getLeavePolicy(input: {
  ctx: TenantContext;
  workspaceId: string;
}): Promise<LeavePolicySummary> {
  assertWorkspaceReadClaim(input.ctx, input.workspaceId);
  const row = await withTenant(input.ctx, (db) =>
    db.leavePolicy.findFirst(),
  );
  return {
    annualQuotaDays: row?.annualQuotaDays ?? DEFAULT_ANNUAL_QUOTA_DAYS,
    updatedAt: row ? row.updatedAt.toISOString() : null,
  };
}

export async function updateLeavePolicy(input: {
  ctx: TenantContext;
  workspaceId: string;
  annualQuotaDays: unknown;
  ip?: string | null;
  userAgent?: string | null;
}): Promise<LeavePolicySummary> {
  assertReview(input.ctx);
  assertWorkspaceReadClaim(input.ctx, input.workspaceId);
  const quota = Number(input.annualQuotaDays);
  if (!Number.isInteger(quota) || quota < 0 || quota > 365) {
    throw new HttpError(400, "INVALID_QUOTA", "Jatah cuti tahunan 0–365 hari");
  }
  const row = await withTenant(input.ctx, (db) =>
    db.$transaction(async (tx) => {
      const saved = await tx.leavePolicy.upsert({
        where: { tenantId: input.ctx.tenantId },
        update: { annualQuotaDays: quota },
        create: {
          id: randomUUID(),
          tenantId: input.ctx.tenantId,
          annualQuotaDays: quota,
        },
      });
      await writeAudit(
        {
          tenantId: input.ctx.tenantId,
          actorType: "USER",
          actorUserId: input.ctx.userId,
          actorMemberId: input.ctx.memberId,
          action: "leave.policy_update",
          resourceType: "leave_policy",
          resourceId: saved.id,
          metadata: { annualQuotaDays: quota },
          ip: input.ip ?? null,
          userAgent: input.userAgent ?? null,
        },
        tx,
      );
      return saved;
    }),
  );
  return {
    annualQuotaDays: row.annualQuotaDays,
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function initializeLeaveBalances(input: {
  ctx: TenantContext;
  workspaceId: string;
  year?: unknown;
  resetUsed?: boolean;
  ip?: string | null;
  userAgent?: string | null;
  now?: Date;
}): Promise<{ year: number; created: number; reset: number; annualQuotaDays: number }> {
  assertReview(input.ctx);
  assertWorkspaceReadClaim(input.ctx, input.workspaceId);
  const now = input.now ?? new Date();
  const year = parseYear(input.year, now);
  const resetUsed = input.resetUsed === true;

  return withTenant(input.ctx, (db) =>
    db.$transaction(async (tx) => {
      const policy = await tx.leavePolicy.findFirst();
      const quota = policy?.annualQuotaDays ?? DEFAULT_ANNUAL_QUOTA_DAYS;
      const members = await tx.workspaceMember.findMany({
        where: { status: "ACTIVE" },
        select: { id: true },
      });
      let created = 0;
      let reset = 0;
      for (const member of members) {
        const existing = await tx.memberLeaveBalance.findFirst({
          where: { memberId: member.id, year },
          select: { id: true },
        });
        if (!existing) {
          await tx.memberLeaveBalance.create({
            data: {
              id: randomUUID(),
              tenantId: input.ctx.tenantId,
              memberId: member.id,
              year,
              entitledDays: quota,
              usedDays: 0,
            },
          });
          created += 1;
        } else if (resetUsed) {
          await tx.memberLeaveBalance.update({
            where: {
              tenantId_id: { tenantId: input.ctx.tenantId, id: existing.id },
            },
            data: { entitledDays: quota, usedDays: 0 },
          });
          reset += 1;
        } else {
          await tx.memberLeaveBalance.update({
            where: {
              tenantId_id: { tenantId: input.ctx.tenantId, id: existing.id },
            },
            data: { entitledDays: quota },
          });
        }
      }
      await writeAudit(
        {
          tenantId: input.ctx.tenantId,
          actorType: "USER",
          actorUserId: input.ctx.userId,
          actorMemberId: input.ctx.memberId,
          action: "leave.balance_initialize",
          resourceType: "leave_policy",
          resourceId: input.ctx.tenantId,
          metadata: { year, created, reset, annualQuotaDays: quota },
          ip: input.ip ?? null,
          userAgent: input.userAgent ?? null,
        },
        tx,
      );
      return { year, created, reset, annualQuotaDays: quota };
    }),
  );
}

export async function getMyLeaveBalance(input: {
  ctx: TenantContext;
  year?: unknown;
  now?: Date;
}): Promise<LeaveBalanceSummary> {
  const now = input.now ?? new Date();
  const year = parseYear(input.year, now);
  return withTenant(input.ctx, async (db) => {
    const [policy, balance] = await Promise.all([
      db.leavePolicy.findFirst(),
      db.memberLeaveBalance.findFirst({
        where: { memberId: input.ctx.memberId, year },
      }),
    ]);
    const entitledDays = balance?.entitledDays ?? policy?.annualQuotaDays ?? DEFAULT_ANNUAL_QUOTA_DAYS;
    const usedDays = balance?.usedDays ?? 0;
    return {
      year,
      entitledDays,
      usedDays,
      remainingDays: Math.max(0, entitledDays - usedDays),
    };
  });
}

export async function submitLeaveRequest(input: {
  ctx: TenantContext;
  body: Record<string, unknown>;
  ip?: string | null;
  userAgent?: string | null;
  now?: Date;
}): Promise<LeaveRequestSummary> {
  const leaveType = parseType(input.body.leaveType);
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
  if ((endDate.getTime() - startDate.getTime()) / 86_400_000 > 180) {
    throw new HttpError(400, "INVALID_DATE_RANGE", "Rentang cuti maksimal 181 hari");
  }
  const reason =
    typeof input.body.reason === "string" ? input.body.reason.trim() : "";
  if (reason.length < LEAVE_REASON_MIN_LENGTH || reason.length > LEAVE_REASON_MAX_LENGTH) {
    throw new HttpError(
      400,
      "INVALID_REASON",
      `Alasan cuti ${LEAVE_REASON_MIN_LENGTH}-${LEAVE_REASON_MAX_LENGTH} karakter`,
    );
  }

  const created = await withTenant(input.ctx, (db) =>
    db.$transaction(async (tx) => {
      const [holidays, patternAssignment] = await Promise.all([
        tx.workspaceHoliday.findMany({
          where: { date: { gte: startDate, lte: endDate } },
          select: { date: true },
        }),
        tx.workPatternAssignment.findFirst({
          where: { memberId: input.ctx.memberId },
          include: { workPattern: { include: { days: true } } },
        }),
      ]);
      const patternIndex = createWorkPatternRuleIndex(
        patternAssignment
          ? [
              {
                memberId: input.ctx.memberId,
                workPattern: patternAssignment.workPattern,
              },
            ]
          : [],
      );
      const workingDays = calculateWorkingDays(
        startDate,
        endDate,
        new Set(holidays.map((row) => day(row.date))),
        workPatternWorkingDays(patternIndex, input.ctx.memberId),
      );
      if (workingDays <= 0) {
        throw new HttpError(
          400,
          "NO_WORKING_DAYS",
          "Rentang cuti tidak mencakup hari kerja",
        );
      }
      const overlap = await tx.leaveRequest.findFirst({
        where: {
          memberId: input.ctx.memberId,
          status: { in: ["PENDING", "APPROVED"] },
          startDate: { lte: endDate },
          endDate: { gte: startDate },
        },
        select: { id: true },
      });
      if (overlap) {
        throw new HttpError(409, "LEAVE_OVERLAP", "Sudah ada cuti pada rentang tanggal ini");
      }
      if (leaveType === "CUTI_TAHUNAN") {
        const year = startDate.getUTCFullYear();
        const policy = await tx.leavePolicy.findFirst();
        const quota = policy?.annualQuotaDays ?? DEFAULT_ANNUAL_QUOTA_DAYS;
        const balance = await tx.memberLeaveBalance.findFirst({
          where: { memberId: input.ctx.memberId, year },
        });
        if ((balance?.entitledDays ?? quota) - (balance?.usedDays ?? 0) < workingDays) {
          throw new HttpError(
            409,
            "INSUFFICIENT_LEAVE_BALANCE",
            "Sisa kuota cuti tahunan tidak mencukupi",
          );
        }
      }
      const row = await tx.leaveRequest.create({
        data: {
          id: randomUUID(),
          tenantId: input.ctx.tenantId,
          memberId: input.ctx.memberId,
          leaveType,
          startDate,
          endDate,
          workingDays,
          reason,
        },
        include: INCLUDE,
      });
      await writeAudit(
        {
          tenantId: input.ctx.tenantId,
          actorType: "USER",
          actorUserId: input.ctx.userId,
          actorMemberId: input.ctx.memberId,
          action: "leave.request",
          resourceType: "leave_request",
          resourceId: row.id,
          metadata: {
            leaveType,
            startDate: day(startDate),
            endDate: day(endDate),
            workingDays,
            reasonLength: reason.length,
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

export async function createLeaveRequestByAdmin(input: {
  ctx: TenantContext;
  workspaceId: string;
  body: Record<string, unknown>;
  ip?: string | null;
  userAgent?: string | null;
  now?: Date;
}): Promise<LeaveRequestSummary> {
  assertReview(input.ctx);
  assertWorkspaceReadClaim(input.ctx, input.workspaceId);
  const memberId = input.body.memberId;
  if (typeof memberId !== "string" || !isUuid(memberId)) {
    throw new HttpError(400, "INVALID_MEMBER", "Karyawan tidak valid");
  }
  const leaveType = parseType(input.body.leaveType);
  const status = parseAdminCreateStatus(input.body.status);
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
  if ((endDate.getTime() - startDate.getTime()) / 86_400_000 > 180) {
    throw new HttpError(400, "INVALID_DATE_RANGE", "Rentang cuti maksimal 181 hari");
  }
  const reason = typeof input.body.reason === "string" ? input.body.reason.trim() : "";
  if (reason.length < LEAVE_REASON_MIN_LENGTH || reason.length > LEAVE_REASON_MAX_LENGTH) {
    throw new HttpError(
      400,
      "INVALID_REASON",
      `Alasan cuti ${LEAVE_REASON_MIN_LENGTH}-${LEAVE_REASON_MAX_LENGTH} karakter`,
    );
  }

  const member = await withTenant(input.ctx, (db) =>
    db.workspaceMember.findFirst({
      where: { id: memberId, status: "ACTIVE" },
      select: { id: true },
    }),
  );
  if (!member) {
    throw new HttpError(404, "MEMBER_NOT_FOUND", "Karyawan aktif tidak ditemukan");
  }

  const now = input.now ?? new Date();
  const created = await withTenant(input.ctx, (db) =>
    db.$transaction(async (tx) => {
      const [holidays, patternAssignment] = await Promise.all([
        tx.workspaceHoliday.findMany({
          where: { date: { gte: startDate, lte: endDate } },
          select: { date: true },
        }),
        tx.workPatternAssignment.findFirst({
          where: { memberId },
          include: { workPattern: { include: { days: true } } },
        }),
      ]);
      const patternIndex = createWorkPatternRuleIndex(
        patternAssignment
          ? [{ memberId, workPattern: patternAssignment.workPattern }]
          : [],
      );
      const workingDays = calculateWorkingDays(
        startDate,
        endDate,
        new Set(holidays.map((row) => day(row.date))),
        workPatternWorkingDays(patternIndex, memberId),
      );
      if (workingDays <= 0) {
        throw new HttpError(400, "NO_WORKING_DAYS", "Rentang cuti tidak mencakup hari kerja");
      }
      const overlap = await tx.leaveRequest.findFirst({
        where: {
          memberId,
          status: { in: ["PENDING", "APPROVED"] },
          startDate: { lte: endDate },
          endDate: { gte: startDate },
        },
        select: { id: true },
      });
      if (overlap) {
        throw new HttpError(409, "LEAVE_OVERLAP", "Sudah ada cuti pada rentang tanggal ini");
      }
      const year = startDate.getUTCFullYear();
      let balance:
        | { id: string; entitledDays: number; usedDays: number }
        | null = null;
      if (leaveType === "CUTI_TAHUNAN") {
        const policy = await tx.leavePolicy.findFirst();
        const quota = policy?.annualQuotaDays ?? DEFAULT_ANNUAL_QUOTA_DAYS;
        balance = await tx.memberLeaveBalance.findFirst({
          where: { memberId, year },
          select: { id: true, entitledDays: true, usedDays: true },
        });
        if ((balance?.entitledDays ?? quota) - (balance?.usedDays ?? 0) < workingDays) {
          throw new HttpError(
            409,
            "INSUFFICIENT_LEAVE_BALANCE",
            "Sisa kuota cuti tahunan tidak mencukupi",
          );
        }
      }
      const row = await tx.leaveRequest.create({
        data: {
          id: randomUUID(),
          tenantId: input.ctx.tenantId,
          memberId,
          leaveType,
          startDate,
          endDate,
          workingDays,
          reason,
          status,
          reviewedByMemberId: status === "APPROVED" ? input.ctx.memberId : null,
          reviewedAt: status === "APPROVED" ? now : null,
        },
        include: INCLUDE,
      });
      if (status === "APPROVED" && leaveType === "CUTI_TAHUNAN") {
        const policy = await tx.leavePolicy.findFirst();
        const entitled = balance?.entitledDays ?? policy?.annualQuotaDays ?? DEFAULT_ANNUAL_QUOTA_DAYS;
        if (balance) {
          await tx.memberLeaveBalance.update({
            where: { tenantId_id: { tenantId: input.ctx.tenantId, id: balance.id } },
            data: { usedDays: balance.usedDays + workingDays },
          });
        } else {
          await tx.memberLeaveBalance.create({
            data: {
              id: randomUUID(),
              tenantId: input.ctx.tenantId,
              memberId,
              year,
              entitledDays: entitled,
              usedDays: workingDays,
            },
          });
        }
      }
      if (status === "APPROVED") {
        await createInAppNotification(tx, {
          tenantId: input.ctx.tenantId,
          memberId,
          type: "LEAVE_APPROVED",
          title: "Permohonan cuti dicatat dan disetujui",
          body: `Admin mencatat cuti ${leaveType} untuk ${day(startDate)} sampai ${day(endDate)} (${workingDays} hari kerja).`,
          linkUrl: `/workspaces/${input.ctx.tenantId}/leave`,
        });
      }
      await writeAudit(
        {
          tenantId: input.ctx.tenantId,
          actorType: "USER",
          actorUserId: input.ctx.userId,
          actorMemberId: input.ctx.memberId,
          action: "leave.admin_create",
          resourceType: "leave_request",
          resourceId: row.id,
          metadata: {
            memberId,
            leaveType,
            status,
            startDate: day(startDate),
            endDate: day(endDate),
            workingDays,
            reasonLength: reason.length,
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

export async function listMyLeaveRequests(input: {
  ctx: TenantContext;
  status?: string | undefined;
}): Promise<LeaveRequestSummary[]> {
  const status = parseStatus(input.status);
  const rows = await withTenant(input.ctx, (db) =>
    db.leaveRequest.findMany({
      where: {
        memberId: input.ctx.memberId,
        ...(status ? { status } : {}),
      },
      include: INCLUDE,
      orderBy: [{ startDate: "desc" }, { createdAt: "desc" }],
    }),
  );
  return rows.map(toSummary);
}

export async function listWorkspaceLeaveRequests(input: {
  ctx: TenantContext;
  workspaceId: string;
  status?: string | undefined;
  memberId?: string | undefined;
}): Promise<LeaveRequestSummary[]> {
  assertReview(input.ctx);
  assertWorkspaceReadClaim(input.ctx, input.workspaceId);
  if (input.memberId && !isUuid(input.memberId)) {
    throw new HttpError(400, "INVALID_MEMBER", "Member tidak valid");
  }
  const status = parseStatus(input.status);
  const rows = await withTenant(input.ctx, (db) =>
    db.leaveRequest.findMany({
      where: {
        ...(status ? { status } : {}),
        ...(input.memberId ? { memberId: input.memberId } : {}),
      },
      include: INCLUDE,
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: 200,
    }),
  );
  return rows.map(toSummary);
}

export async function reviewLeaveRequest(input: {
  ctx: TenantContext;
  workspaceId?: string | undefined;
  leaveId: string;
  action: string;
  rejectionReason?: string | undefined;
  ip?: string | null;
  userAgent?: string | null;
  now?: Date;
}): Promise<LeaveRequestSummary> {
  if (input.workspaceId) assertWorkspaceReadClaim(input.ctx, input.workspaceId);
  if (!isUuid(input.leaveId)) {
    throw new HttpError(400, "INVALID_LEAVE", "Pengajuan cuti tidak valid");
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
  const now = input.now ?? new Date();

  const updated = await withTenant(input.ctx, (db) =>
    db.$transaction(async (tx) => {
      const existing = await tx.leaveRequest.findFirst({
        where: { id: input.leaveId },
        include: INCLUDE,
      });
      if (!existing) {
        throw new HttpError(404, "LEAVE_NOT_FOUND", "Pengajuan cuti tidak ditemukan");
      }
      if (existing.status !== "PENDING") {
        throw new HttpError(409, "ALREADY_REVIEWED", "Pengajuan cuti sudah direview");
      }

      const resolved = await resolveApprovalStep(
        tx,
        input.ctx.tenantId,
        "LEAVE",
        existing.currentApprovalLevel,
      );
      if (resolved?.step) {
        assertApprovalActor({ ctx: input.ctx, step: resolved.step });
      } else {
        assertReview(input.ctx);
      }
      let status: LeaveStatus = "APPROVED";
      let nextLevel = existing.currentApprovalLevel;
      if (action === "APPROVE") {
        if (resolved?.step) {
          nextLevel = resolved.step.level;
          if (resolved.step.level < resolved.totalSteps) status = "PENDING";
        } else {
          nextLevel = resolved?.totalSteps ?? existing.currentApprovalLevel;
        }
      } else {
        status = "REJECTED";
      }

      if (
        status === "APPROVED" &&
        existing.leaveType === "CUTI_TAHUNAN"
      ) {
        const year = existing.startDate.getUTCFullYear();
        const policy = await tx.leavePolicy.findFirst();
        const quota = policy?.annualQuotaDays ?? DEFAULT_ANNUAL_QUOTA_DAYS;
        const balance = await tx.memberLeaveBalance.findFirst({
          where: { memberId: existing.memberId, year },
        });
        const entitled = balance?.entitledDays ?? quota;
        const used = balance?.usedDays ?? 0;
        if (used + existing.workingDays > entitled) {
          throw new HttpError(
            409,
            "INSUFFICIENT_LEAVE_BALANCE",
            "Sisa kuota cuti tahunan tidak mencukupi",
          );
        }
        if (balance) {
          await tx.memberLeaveBalance.update({
            where: {
              tenantId_id: { tenantId: input.ctx.tenantId, id: balance.id },
            },
            data: { usedDays: used + existing.workingDays },
          });
        } else {
          await tx.memberLeaveBalance.create({
            data: {
              id: randomUUID(),
              tenantId: input.ctx.tenantId,
              memberId: existing.memberId,
              year,
              entitledDays: entitled,
              usedDays: existing.workingDays,
            },
          });
        }
      }

      const row = await tx.leaveRequest.update({
        where: { tenantId_id: { tenantId: input.ctx.tenantId, id: existing.id } },
        data: {
          status,
          currentApprovalLevel: nextLevel,
          reviewedByMemberId: input.ctx.memberId,
          reviewedAt: now,
          rejectionReason: action === "REJECT" ? rejectionReason : null,
        },
        include: INCLUDE,
      });
      const leaveStart = existing.startDate.toISOString().slice(0, 10);
      const leaveEnd = existing.endDate.toISOString().slice(0, 10);
      const leaveDate =
        leaveStart === leaveEnd ? leaveStart : `${leaveStart} s.d. ${leaveEnd}`;
      await createInAppNotification(tx, {
        tenantId: input.ctx.tenantId,
        memberId: existing.memberId,
        type:
          status === "PENDING"
            ? "LEAVE_NEXT_APPROVAL"
            : action === "REJECT"
              ? "LEAVE_REJECTED"
              : "LEAVE_APPROVED",
        title:
          status === "PENDING"
            ? `Cuti ${leaveDate} menunggu level berikutnya`
            : action === "REJECT"
              ? `Cuti ${leaveDate} ditolak`
              : `Cuti ${leaveDate} disetujui`,
        body:
          status === "PENDING"
            ? `Pengajuan cuti tanggal ${leaveDate} disetujui pada level ini dan diteruskan ke approver berikutnya.`
            : action === "REJECT"
              ? `Pengajuan cuti tanggal ${leaveDate} ditolak. Catatan admin: ${rejectionReason}`
              : `Pengajuan cuti tanggal ${leaveDate} disetujui penuh.`,
        linkUrl: `/workspaces/${input.ctx.tenantId}/leave`,
      });
      await writeAudit(
        {
          tenantId: input.ctx.tenantId,
          actorType: "USER",
          actorUserId: input.ctx.userId,
          actorMemberId: input.ctx.memberId,
          action:
            action === "REJECT"
              ? "leave.reject"
              : status === "PENDING"
                ? "leave.step"
                : "leave.approve",
          resourceType: "leave_request",
          resourceId: existing.id,
          metadata: {
            memberId: existing.memberId,
            leaveType: existing.leaveType,
            workingDays: existing.workingDays,
            status,
            level: nextLevel,
            ...(action === "REJECT" ? { reasonLength: rejectionReason.length } : {}),
          },
          ip: input.ip ?? null,
          userAgent: input.userAgent ?? null,
        },
        tx,
      );
      return row;
    }),
  );

  const summary = toSummary(updated);
  const forwarded = summary.status === "PENDING";
  const approved = action === "APPROVE";
  const leaveDate =
    summary.startDate === summary.endDate
      ? summary.startDate
      : `${summary.startDate} s.d. ${summary.endDate}`;
  await sendPushNotificationToMember({
    ctx: input.ctx,
    memberId: summary.memberId,
    message: {
      title: approved
        ? forwarded
          ? `Cuti ${leaveDate} menunggu level berikutnya`
          : `Cuti ${leaveDate} disetujui`
        : `Cuti ${leaveDate} ditolak`,
      body: approved
        ? forwarded
          ? "Pengajuan cuti Anda disetujui pada level ini dan diteruskan ke approver berikutnya."
          : `Pengajuan cuti ${leaveDate} disetujui penuh.`
        : "Pengajuan cuti Anda ditolak. Buka aplikasi untuk melihat catatan admin.",
      data: {
        type: "leave_result",
        leaveId: summary.id,
        status: summary.status,
      },
    },
  });
  return summary;
}

export async function getLeaveReport(input: {
  ctx: TenantContext;
  workspaceId: string;
  year?: unknown;
  now?: Date;
}): Promise<LeaveReport> {
  assertReview(input.ctx);
  assertWorkspaceReadClaim(input.ctx, input.workspaceId);
  const now = input.now ?? new Date();
  const year = parseYear(input.year, now);
  const start = new Date(Date.UTC(year, 0, 1));
  const end = new Date(Date.UTC(year + 1, 0, 1));

  return withTenant(input.ctx, async (db) => {
    const [policy, members, balances, pending] = await Promise.all([
      db.leavePolicy.findFirst(),
      db.workspaceMember.findMany({
        where: { status: "ACTIVE" },
        include: {
          user: { select: { name: true, email: true } },
          division: { select: { name: true } },
        },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      }),
      db.memberLeaveBalance.findMany({ where: { year } }),
      db.leaveRequest.findMany({
        where: {
          leaveType: "CUTI_TAHUNAN",
          status: "PENDING",
          startDate: { lt: end },
          endDate: { gte: start },
        },
        select: { memberId: true, workingDays: true },
      }),
    ]);
    const quota = policy?.annualQuotaDays ?? DEFAULT_ANNUAL_QUOTA_DAYS;
    const balanceByMember = new Map(balances.map((row) => [row.memberId, row]));
    const pendingByMember = new Map<string, number>();
    for (const row of pending) {
      pendingByMember.set(
        row.memberId,
        (pendingByMember.get(row.memberId) ?? 0) + row.workingDays,
      );
    }
    const rows: LeaveReportRow[] = members.map((member) => {
      const balance = balanceByMember.get(member.id);
      const entitledDays = balance?.entitledDays ?? quota;
      const usedDays = balance?.usedDays ?? 0;
      return {
        memberId: member.id,
        memberName: member.user.name,
        memberEmail: member.user.email,
        divisionName: member.division?.name ?? null,
        entitledDays,
        usedDays,
        remainingDays: Math.max(0, entitledDays - usedDays),
        pendingDays: pendingByMember.get(member.id) ?? 0,
      };
    });
    const totals = rows.reduce(
      (acc, row) => {
        acc.entitledDays += row.entitledDays;
        acc.usedDays += row.usedDays;
        acc.remainingDays += row.remainingDays;
        acc.pendingDays += row.pendingDays;
        return acc;
      },
      { entitledDays: 0, usedDays: 0, remainingDays: 0, pendingDays: 0 },
    );
    return { year, annualQuotaDays: quota, rows, totals };
  });
}
