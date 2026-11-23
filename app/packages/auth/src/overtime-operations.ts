import { randomUUID } from "node:crypto";

import { isUuid, withTenant, writeAudit, type TenantContext } from "@absensi/database";

import { HttpError } from "./http.js";
import { parseReportDay, startOfUtcDay } from "./reports.js";
import { assertWorkspaceReadClaim } from "./workspaces.js";

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
const DAY_MS = 86_400_000;

export type OvertimeSettingSummary = {
  id: string | null;
  minDurationMinutes: number;
  roundingMinutes: number;
  maxDailyMinutes: number;
  maxMonthlyMinutes: number;
  weekdayMultiplier: number;
  holidayMultiplier: number;
  updatedAt: string | null;
};

export type OvertimeScheduleSummary = {
  id: string;
  memberId: string;
  memberName: string;
  memberEmail: string;
  divisionName: string | null;
  date: string;
  startTime: string;
  endTime: string;
  durationMinutes: number;
  notes: string | null;
  status: string;
  createdAt: string;
};

const SETTING_DEFAULTS: OvertimeSettingSummary = {
  id: null,
  minDurationMinutes: 30,
  roundingMinutes: 15,
  maxDailyMinutes: 240,
  maxMonthlyMinutes: 4800,
  weekdayMultiplier: 1.5,
  holidayMultiplier: 2,
  updatedAt: null,
};

function assertRead(ctx: TenantContext): void {
  if (!ctx.permissions.includes("attendance.read") && !ctx.permissions.includes("correction.review")) {
    throw new HttpError(403, "FORBIDDEN", "Permission tidak mencukupi");
  }
}

function assertReview(ctx: TenantContext): void {
  if (!ctx.permissions.includes("correction.review")) {
    throw new HttpError(403, "FORBIDDEN", "Permission tidak mencukupi");
  }
}

function boundedInt(value: unknown, field: string, min: number, max: number): number {
  const number = Number(value);
  if (!Number.isInteger(number) || number < min || number > max) {
    throw new HttpError(400, "INVALID_NUMBER", `${field} harus ${min}-${max}`);
  }
  return number;
}

function multiplier(value: unknown, field: string, fallback: number): number {
  if (value === undefined) return fallback;
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0.1 || number > 10) {
    throw new HttpError(400, "INVALID_MULTIPLIER", `${field} harus 0.1-10`);
  }
  return Math.round(number * 100) / 100;
}

function time(value: unknown, field: string): string {
  if (typeof value !== "string" || !TIME_PATTERN.test(value.trim())) {
    throw new HttpError(400, "INVALID_TIME", `${field} harus berformat HH:MM`);
  }
  return value.trim();
}

function minutes(value: string): number {
  return Number(value.slice(0, 2)) * 60 + Number(value.slice(3, 5));
}

function toSetting(row: {
  id: string;
  minDurationMinutes: number;
  roundingMinutes: number;
  maxDailyMinutes: number;
  maxMonthlyMinutes: number;
  weekdayMultiplier: number;
  holidayMultiplier: number;
  updatedAt: Date;
}): OvertimeSettingSummary {
  return {
    id: row.id,
    minDurationMinutes: row.minDurationMinutes,
    roundingMinutes: row.roundingMinutes,
    maxDailyMinutes: row.maxDailyMinutes,
    maxMonthlyMinutes: row.maxMonthlyMinutes,
    weekdayMultiplier: row.weekdayMultiplier,
    holidayMultiplier: row.holidayMultiplier,
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function getOvertimeSetting(input: {
  ctx: TenantContext;
  workspaceId: string;
}): Promise<OvertimeSettingSummary> {
  assertRead(input.ctx);
  assertWorkspaceReadClaim(input.ctx, input.workspaceId);
  const row = await withTenant(input.ctx, (db) => db.overtimeSetting.findFirst());
  return row ? toSetting(row) : SETTING_DEFAULTS;
}

export async function updateOvertimeSetting(input: {
  ctx: TenantContext;
  workspaceId: string;
  body: Record<string, unknown>;
  ip?: string | null;
  userAgent?: string | null;
}): Promise<OvertimeSettingSummary> {
  assertReview(input.ctx);
  assertWorkspaceReadClaim(input.ctx, input.workspaceId);
  const current = await withTenant(input.ctx, (db) => db.overtimeSetting.findFirst());
  const fallback = current ? toSetting(current) : SETTING_DEFAULTS;
  const values = {
    minDurationMinutes: boundedInt(
      input.body.minDurationMinutes ?? fallback.minDurationMinutes,
      "Durasi minimum",
      1,
      720,
    ),
    roundingMinutes: boundedInt(
      input.body.roundingMinutes ?? fallback.roundingMinutes,
      "Pembulatan",
      1,
      120,
    ),
    maxDailyMinutes: boundedInt(
      input.body.maxDailyMinutes ?? fallback.maxDailyMinutes,
      "Batas harian",
      1,
      1440,
    ),
    maxMonthlyMinutes: boundedInt(
      input.body.maxMonthlyMinutes ?? fallback.maxMonthlyMinutes,
      "Batas bulanan",
      1,
      44_640,
    ),
    weekdayMultiplier: multiplier(
      input.body.weekdayMultiplier,
      "Pengali hari kerja",
      fallback.weekdayMultiplier,
    ),
    holidayMultiplier: multiplier(
      input.body.holidayMultiplier,
      "Pengali hari libur",
      fallback.holidayMultiplier,
    ),
  };
  const row = await withTenant(input.ctx, (db) =>
    db.$transaction(async (tx) => {
      const saved = current
        ? await tx.overtimeSetting.update({
            where: { tenantId_id: { tenantId: input.ctx.tenantId, id: current.id } },
            data: values,
          })
        : await tx.overtimeSetting.create({
            data: { id: randomUUID(), tenantId: input.ctx.tenantId, ...values },
          });
      await writeAudit(
        {
          tenantId: input.ctx.tenantId,
          actorType: "USER",
          actorUserId: input.ctx.userId,
          actorMemberId: input.ctx.memberId,
          action: "overtime.setting_update",
          resourceType: "overtime_setting",
          resourceId: saved.id,
          metadata: values,
          ip: input.ip ?? null,
          userAgent: input.userAgent ?? null,
        },
        tx,
      );
      return saved;
    }),
  );
  return toSetting(row);
}

const SCHEDULE_INCLUDE = {
  member: {
    include: {
      user: { select: { name: true, email: true } },
      division: { select: { name: true } },
    },
  },
} as const;

function toSchedule(row: {
  id: string;
  memberId: string;
  date: Date;
  startTime: string;
  endTime: string;
  durationMinutes: number;
  notes: string | null;
  status: string;
  createdAt: Date;
  member: {
    user: { name: string; email: string };
    division: { name: string } | null;
  };
}): OvertimeScheduleSummary {
  return {
    id: row.id,
    memberId: row.memberId,
    memberName: row.member.user.name,
    memberEmail: row.member.user.email,
    divisionName: row.member.division?.name ?? null,
    date: row.date.toISOString().slice(0, 10),
    startTime: row.startTime,
    endTime: row.endTime,
    durationMinutes: row.durationMinutes,
    notes: row.notes,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function listOvertimeSchedules(input: {
  ctx: TenantContext;
  workspaceId: string;
  from?: string | undefined;
  to?: string | undefined;
  memberId?: string | undefined;
}): Promise<OvertimeScheduleSummary[]> {
  assertReview(input.ctx);
  assertWorkspaceReadClaim(input.ctx, input.workspaceId);
  if (input.memberId && !isUuid(input.memberId)) {
    throw new HttpError(400, "INVALID_MEMBER", "Karyawan tidak valid");
  }
  const from = input.from ? parseReportDay(input.from, "from") : undefined;
  const to = input.to ? parseReportDay(input.to, "to") : undefined;
  const rows = await withTenant(input.ctx, (db) =>
    db.overtimeSchedule.findMany({
      where: {
        ...(from || to
          ? {
              date: {
                ...(from ? { gte: from } : {}),
                ...(to ? { lte: to } : {}),
              },
            }
          : {}),
        ...(input.memberId ? { memberId: input.memberId } : {}),
      },
      include: SCHEDULE_INCLUDE,
      orderBy: [{ date: "asc" }, { startTime: "asc" }, { id: "asc" }],
      take: 250,
    }),
  );
  return rows.map(toSchedule);
}

export async function createOvertimeSchedule(input: {
  ctx: TenantContext;
  workspaceId: string;
  body: Record<string, unknown>;
  ip?: string | null;
  userAgent?: string | null;
}): Promise<OvertimeScheduleSummary> {
  assertReview(input.ctx);
  assertWorkspaceReadClaim(input.ctx, input.workspaceId);
  const memberId = typeof input.body.memberId === "string" ? input.body.memberId.trim() : "";
  if (!isUuid(memberId)) {
    throw new HttpError(400, "INVALID_MEMBER", "Karyawan wajib dipilih");
  }
  const date = parseReportDay(
    typeof input.body.date === "string" ? input.body.date : "",
    "date",
  );
  const startTime = time(input.body.startTime, "Jam mulai");
  const endTime = time(input.body.endTime, "Jam selesai");
  const durationMinutes = minutes(endTime) - minutes(startTime);
  if (durationMinutes <= 0 || durationMinutes > 12 * 60) {
    throw new HttpError(400, "INVALID_DURATION", "Durasi lembur 1-720 menit");
  }
  const notes =
    typeof input.body.notes === "string" ? input.body.notes.trim() : "";
  if (notes.length > 1000) {
    throw new HttpError(400, "INVALID_NOTES", "Catatan maksimal 1000 karakter");
  }
  const row = await withTenant(input.ctx, (db) =>
    db.$transaction(async (tx) => {
      const member = await tx.workspaceMember.findFirst({
        where: { id: memberId, status: "ACTIVE" },
        select: { id: true },
      });
      if (!member) {
        throw new HttpError(404, "MEMBER_NOT_FOUND", "Karyawan aktif tidak ditemukan");
      }
      const saved = await tx.overtimeSchedule.create({
        data: {
          id: randomUUID(),
          tenantId: input.ctx.tenantId,
          memberId,
          date,
          startTime,
          endTime,
          durationMinutes,
          notes: notes || null,
          createdByMemberId: input.ctx.memberId,
        },
        include: SCHEDULE_INCLUDE,
      });
      await writeAudit(
        {
          tenantId: input.ctx.tenantId,
          actorType: "USER",
          actorUserId: input.ctx.userId,
          actorMemberId: input.ctx.memberId,
          action: "overtime.schedule_create",
          resourceType: "overtime_schedule",
          resourceId: saved.id,
          metadata: { memberId, date: date.toISOString().slice(0, 10), durationMinutes },
          ip: input.ip ?? null,
          userAgent: input.userAgent ?? null,
        },
        tx,
      );
      return saved;
    }),
  );
  return toSchedule(row);
}

export async function cancelOvertimeSchedule(input: {
  ctx: TenantContext;
  workspaceId: string;
  scheduleId: string;
  ip?: string | null;
  userAgent?: string | null;
}): Promise<OvertimeScheduleSummary> {
  assertReview(input.ctx);
  assertWorkspaceReadClaim(input.ctx, input.workspaceId);
  if (!isUuid(input.scheduleId)) {
    throw new HttpError(404, "OVERTIME_SCHEDULE_NOT_FOUND", "Jadwal lembur tidak ditemukan");
  }
  const row = await withTenant(input.ctx, (db) =>
    db.$transaction(async (tx) => {
      const existing = await tx.overtimeSchedule.findFirst({
        where: { id: input.scheduleId },
        include: SCHEDULE_INCLUDE,
      });
      if (!existing) {
        throw new HttpError(404, "OVERTIME_SCHEDULE_NOT_FOUND", "Jadwal lembur tidak ditemukan");
      }
      if (existing.status === "CANCELLED") {
        throw new HttpError(409, "ALREADY_CANCELLED", "Jadwal lembur sudah dibatalkan");
      }
      const saved = await tx.overtimeSchedule.update({
        where: { tenantId_id: { tenantId: input.ctx.tenantId, id: existing.id } },
        data: { status: "CANCELLED" },
        include: SCHEDULE_INCLUDE,
      });
      await writeAudit(
        {
          tenantId: input.ctx.tenantId,
          actorType: "USER",
          actorUserId: input.ctx.userId,
          actorMemberId: input.ctx.memberId,
          action: "overtime.schedule_cancel",
          resourceType: "overtime_schedule",
          resourceId: saved.id,
          metadata: { memberId: existing.memberId, date: existing.date.toISOString().slice(0, 10) },
          ip: input.ip ?? null,
          userAgent: input.userAgent ?? null,
        },
        tx,
      );
      return saved;
    }),
  );
  return toSchedule(row);
}

export async function listMyOvertimeSchedules(input: {
  ctx: TenantContext;
  now?: Date;
}): Promise<OvertimeScheduleSummary[]> {
  if (!input.ctx.permissions.includes("workspace.read")) {
    throw new HttpError(403, "FORBIDDEN", "Permission tidak mencukupi");
  }
  const today = startOfUtcDay(input.now ?? new Date());
  const until = new Date(today.getTime() + 60 * DAY_MS);
  const rows = await withTenant(input.ctx, (db) =>
    db.overtimeSchedule.findMany({
      where: {
        memberId: input.ctx.memberId,
        status: "PLANNED",
        date: { gte: today, lte: until },
      },
      include: SCHEDULE_INCLUDE,
      orderBy: [{ date: "asc" }, { startTime: "asc" }],
      take: 40,
    }),
  );
  return rows.map(toSchedule);
}

export type OvertimeBreakdown = {
  minutes: number;
  weekdayMinutes: number;
  holidayMinutes: number;
};

/**
 * Terapkan durasi minimum, pembulatan, batas harian, dan batas bulanan.
 * Tanpa baris pengaturan, nilai mentah dipertahankan agar payroll lama stabil.
 */
export function calculateOvertimeBreakdown(input: {
  setting: {
    minDurationMinutes: number;
    roundingMinutes: number;
    maxDailyMinutes: number;
    maxMonthlyMinutes: number;
  } | null;
  requests: Array<{ date: Date; durationMinutes: number }>;
  holidayDates: Set<string>;
}): OvertimeBreakdown {
  const rows = [...input.requests].sort((left, right) => left.date.getTime() - right.date.getTime());
  if (!input.setting) {
    let weekday = 0;
    let holiday = 0;
    for (const row of rows) {
      if (input.holidayDates.has(row.date.toISOString().slice(0, 10))) holiday += row.durationMinutes;
      else weekday += row.durationMinutes;
    }
    return { minutes: weekday + holiday, weekdayMinutes: weekday, holidayMinutes: holiday };
  }
  const daily = new Map<string, number>();
  let weekdayMinutes = 0;
  let holidayMinutes = 0;
  let monthMinutes = 0;
  for (const row of rows) {
    if (row.durationMinutes < input.setting.minDurationMinutes) continue;
    const rounded =
      Math.ceil(row.durationMinutes / input.setting.roundingMinutes) *
      input.setting.roundingMinutes;
    const key = row.date.toISOString().slice(0, 10);
    const used = daily.get(key) ?? 0;
    const eligible = Math.min(
      rounded,
      Math.max(0, input.setting.maxDailyMinutes - used),
      Math.max(0, input.setting.maxMonthlyMinutes - monthMinutes),
    );
    if (eligible <= 0) continue;
    daily.set(key, used + eligible);
    monthMinutes += eligible;
    if (input.holidayDates.has(key)) holidayMinutes += eligible;
    else weekdayMinutes += eligible;
  }
  return {
    minutes: weekdayMinutes + holidayMinutes,
    weekdayMinutes,
    holidayMinutes,
  };
}
