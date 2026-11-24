import { isUuid, withTenant, writeAudit, type TenantContext } from "@absensi/database";

import { HttpError } from "./http.js";
import {
  createWorkPatternRuleIndex,
  isScheduledWorkday,
  lateMinutesForWorkPattern,
  workPatternRuleFor,
  type WorkPatternRuleIndex,
} from "./work-pattern-schedule.js";
import { assertWorkspaceReadClaim } from "./workspaces.js";

export const LATE_TOLERANCE_MINUTES_DEFAULT = 15;
export const BREAK_MINUTES_DEFAULT = 60;
export const REPORT_LIST_LIMIT_DEFAULT = 50;
export const REPORT_LIST_LIMIT_MAX = 100;
export const DASHBOARD_STATUSES = [
  "PRESENT",
  "LATE",
  "ON_SITE",
  "ABSENT",
  "HOLIDAY",
] as const;
export type DashboardStatusFilter = (typeof DASHBOARD_STATUSES)[number];
export const MONTHLY_STATUSES = [
  "PRESENT",
  "INCOMPLETE",
  "ANOMALY",
  "ABSENT",
  "HOLIDAY",
  "WEEKEND",
  "FUTURE",
] as const;

function pageValue(
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

function dayRange(
  from?: string | undefined,
  to?: string | undefined,
): { fromDate?: Date; toDate?: Date } {
  const fromDate = from ? parseReportDay(from, "from") : undefined;
  const toDate = to ? parseReportDay(to, "to") : undefined;
  if (fromDate && toDate && fromDate.getTime() > toDate.getTime()) {
    throw new HttpError(400, "INVALID_DATE_RANGE", "Rentang tanggal tidak valid");
  }
  return {
    ...(fromDate ? { fromDate } : {}),
    ...(toDate ? { toDate } : {}),
  };
}

function optionalEnvInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

export function lateToleranceMinutes(): number {
  return optionalEnvInt("LATE_TOLERANCE_MINUTES", LATE_TOLERANCE_MINUTES_DEFAULT);
}

export function breakMinutes(): number {
  return optionalEnvInt("BREAK_MINUTES", BREAK_MINUTES_DEFAULT);
}

export function startOfUtcDay(value: Date): Date {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
}

export function parseReportDay(value: string, label: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new HttpError(400, "INVALID_DATE", `Parameter ${label} harus berformat YYYY-MM-DD`);
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) {
    throw new HttpError(400, "INVALID_DATE", `Parameter ${label} tidak valid`);
  }
  return date;
}

function minutesOfDay(value: string): number {
  const [hour, minute] = value.split(":").map(Number);
  return (hour ?? 0) * 60 + (minute ?? 0);
}

/** Menit sejak tengah malam pada timezone kantor. */
export function zonedMinutes(date: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(date);
  const hour = Number(parts.find((part) => part.type === "hour")?.value ?? "0");
  const minute = Number(parts.find((part) => part.type === "minute")?.value ?? "0");
  return (hour % 24) * 60 + minute;
}

export type DashboardMemberStatus =
  | "PRESENT"
  | "LATE"
  | "ON_SITE"
  | "ABSENT"
  | "HOLIDAY";

export type DashboardMember = {
  memberId: string;
  name: string;
  divisionName: string | null;
  status: DashboardMemberStatus;
  checkIn: string | null;
  checkOut: string | null;
  lateMinutes: number;
};

export type TodayDashboard = {
  date: string;
  totalMembers: number;
  checkedIn: number;
  late: number;
  absent: number;
  onSite: number;
  correctionsPending: number;
  holiday: string | null;
  /** Timezone kantor aktif; null bila belum ada kantor. */
  timezone: string | null;
  members: DashboardMember[];
  pagination: DashboardPagination;
};

export type DashboardPagination = { limit: number; offset: number; total: number };

export type TodayDashboardInput = {
  ctx: TenantContext;
  workspaceId: string;
  date?: string | undefined;
  memberId?: string | undefined;
  divisionId?: string | undefined;
  positionId?: string | undefined;
  status?: string | undefined;
  limit?: number | undefined;
  offset?: number | undefined;
  now?: Date | undefined;
};

/**
 * Ringkasan hari ini. Hari libur dibaca dari workspace_holidays, bukan env.
 * `:workspaceId` hanya klaim; tenant selalu dari ctx.
 */
export async function getTodayDashboard(input: TodayDashboardInput): Promise<TodayDashboard> {
  assertWorkspaceReadClaim(input.ctx, input.workspaceId);
  const date = input.date
    ? parseReportDay(input.date, "date")
    : startOfUtcDay(input.now ?? new Date());
  if (input.memberId && !isUuid(input.memberId)) {
    throw new HttpError(400, "INVALID_MEMBER", "Parameter memberId tidak valid");
  }
  const statusFilter = input.status?.trim().toUpperCase();
  if (
    statusFilter &&
    !(DASHBOARD_STATUSES as readonly string[]).includes(statusFilter)
  ) {
    throw new HttpError(400, "INVALID_STATUS", "Status dashboard tidak valid");
  }
  const limit = pageValue(input.limit, REPORT_LIST_LIMIT_DEFAULT, 1, REPORT_LIST_LIMIT_MAX);
  const offset = pageValue(input.offset, 0, 0, Number.MAX_SAFE_INTEGER);
  const tolerance = lateToleranceMinutes();

  return withTenant(input.ctx, async (db) => {
    const [members, groupedLogs, holiday, office, correctionsPending, patternAssignments] =
      await Promise.all([
      db.workspaceMember.findMany({
        where: {
          status: "ACTIVE",
          ...(input.divisionId ? { divisionId: input.divisionId } : {}),
          ...(input.positionId ? { positionId: input.positionId } : {}),
        },
        include: {
          user: { select: { name: true } },
          division: { select: { name: true } },
        },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      }),
      // SQL groupBy: satu baris per (member, type) dengan waktu paling awal.
      db.attendanceLog.groupBy({
        by: ["memberId", "type"],
        where: { workDate: date, type: { in: ["CHECK_IN", "CHECK_OUT"] } },
        _min: { timestampServer: true },
      }),
      db.workspaceHoliday.findFirst({ where: { date } }),
      db.officeLocation.findFirst({
        where: { isActive: true },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      }),
      db.correctionRequest.count({ where: { status: "PENDING" } }),
      db.workPatternAssignment.findMany({
        include: { workPattern: { include: { days: true } } },
      }),
    ]);
    const patternIndex = createWorkPatternRuleIndex(patternAssignments);
    const dateKey = formatDay(date);

    const byMember = new Map<string, { checkIn?: Date; checkOut?: Date }>();
    for (const row of groupedLogs) {
      const entry = byMember.get(row.memberId) ?? {};
      const timestamp = row._min.timestampServer;
      if (row.type === "CHECK_IN" && !entry.checkIn && timestamp) entry.checkIn = timestamp;
      if (row.type === "CHECK_OUT" && !entry.checkOut && timestamp) entry.checkOut = timestamp;
      byMember.set(row.memberId, entry);
    }

    const rows: DashboardMember[] = members.map((member) => {
      const entry = byMember.get(member.id);
      const checkIn = entry?.checkIn ?? null;
      const checkOut = entry?.checkOut ?? null;
      const rule = workPatternRuleFor(patternIndex, member.id, date);
      const lateThreshold = rule
        ? minutesOfDay(rule.startTime) + rule.lateToleranceMinutes
        : office
          ? minutesOfDay(office.workStart) + tolerance
          : Number.POSITIVE_INFINITY;
      const lateMinutes =
        checkIn && (rule || office)
          ? rule
            ? lateMinutesForWorkPattern(checkIn, rule, rule.timezone)
            : office
              ? Math.max(0, zonedMinutes(checkIn, office.timezone) - lateThreshold)
              : 0
          : 0;
      const scheduled = isScheduledWorkday(rule, date.getUTCDay());
      const status: DashboardMemberStatus = !checkIn
        ? holiday || !scheduled
          ? "HOLIDAY"
          : "ABSENT"
        : !checkOut
          ? "ON_SITE"
          : lateMinutes > 0
            ? "LATE"
            : "PRESENT";
      return {
        memberId: member.id,
        name: member.user.name,
        divisionName: member.division?.name ?? null,
        status,
        checkIn: checkIn ? checkIn.toISOString() : null,
        checkOut: checkOut ? checkOut.toISOString() : null,
        lateMinutes,
      };
    });

    const visible = rows.filter(
      (row) =>
        (!input.memberId || row.memberId === input.memberId) &&
        (!statusFilter || row.status === statusFilter),
    );

    return {
      date: date.toISOString().slice(0, 10),
      totalMembers: rows.length,
      checkedIn: rows.filter((row) => row.checkIn !== null).length,
      late: rows.filter((row) => row.lateMinutes > 0).length,
      absent: rows.filter((row) => row.status === "ABSENT").length,
      onSite: rows.filter((row) => row.status === "ON_SITE").length,
      correctionsPending,
      holiday: holiday?.name ?? null,
      timezone: office?.timezone ?? null,
      members: visible.slice(offset, offset + limit),
      pagination: { limit, offset, total: rows.length },
    };
  });
}

export type MonthlyDayStatus =
  | "PRESENT"
  | "INCOMPLETE"
  | "ANOMALY"
  | "ABSENT"
  | "HOLIDAY"
  | "WEEKEND"
  | "FUTURE";

export type MonthlyDay = {
  date: string;
  checkIn: string | null;
  checkOut: string | null;
  workHours: number;
  late: number;
  status: MonthlyDayStatus;
};

export type MonthlyMemberReport = {
  memberId: string;
  name: string;
  divisionName: string | null;
  days: MonthlyDay[];
  totalWorkHours: number;
  totalLate: number;
  totalAbsent: number;
};

export type MonthlyReport = {
  year: number;
  month: number;
  /** Timezone kantor aktif; null bila belum ada kantor. */
  timezone: string | null;
  days: string[];
  members: MonthlyMemberReport[];
  pagination: DashboardPagination;
};

export type MonthlyReportInput = {
  ctx: TenantContext;
  workspaceId: string;
  year: string | number;
  month: string | number;
  memberId?: string | undefined;
  divisionId?: string | undefined;
  positionId?: string | undefined;
  from?: string | undefined;
  to?: string | undefined;
  status?: string | undefined;
  limit?: number | undefined;
  offset?: number | undefined;
  now?: Date | undefined;
};

function parseYear(value: string | number): number {
  const year = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(year) || year < 2000 || year > 2100) {
    throw new HttpError(400, "INVALID_YEAR", "Parameter year tidak valid");
  }
  return year;
}

function parseMonth(value: string | number): number {
  const month = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    throw new HttpError(400, "INVALID_MONTH", "Parameter month harus 1-12");
  }
  return month;
}

function formatDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function roundHours(value: number): number {
  return Math.round(value * 100) / 100;
}

type MonthlyBuild = {
  dates: Date[];
  holidayDates: Set<string>;
  today: Date;
  workPatternIndex: WorkPatternRuleIndex;
  toleranceMinutes: number;
  office: { timezone: string; workStart: string } | null;
  statusFilter: string | undefined;
};

function indexLogs(
  logs: Array<{ memberId: string; type: string; workDate: Date; timestampServer: Date }>,
): Map<string, { checkIn?: Date; checkOut?: Date }> {
  const byMemberDay = new Map<string, { checkIn?: Date; checkOut?: Date }>();
  for (const log of logs) {
    const key = `${log.memberId}:${formatDay(log.workDate)}`;
    const entry = byMemberDay.get(key) ?? {};
    if (log.type === "CHECK_IN" && !entry.checkIn) entry.checkIn = log.timestampServer;
    if (log.type === "CHECK_OUT" && !entry.checkOut) entry.checkOut = log.timestampServer;
    byMemberDay.set(key, entry);
  }
  return byMemberDay;
}

function buildMonthlyDays(
  memberId: string,
  byMemberDay: Map<string, { checkIn?: Date; checkOut?: Date }>,
  build: MonthlyBuild,
): MonthlyDay[] {
  const breakMins = breakMinutes();
  const allDays: MonthlyDay[] = build.dates.map((date) => {
    const key = `${memberId}:${formatDay(date)}`;
    const entry = byMemberDay.get(key);
    const checkIn = entry?.checkIn ?? null;
    const checkOut = entry?.checkOut ?? null;
    const isFuture = date.getTime() > build.today.getTime();
    const weekday = date.getUTCDay();
    const rule = workPatternRuleFor(build.workPatternIndex, memberId, date);
    const scheduled = isScheduledWorkday(rule, weekday);
    let late = 0;
    if (checkIn && (rule || build.office)) {
      const threshold = minutesOfDay(build.office?.workStart ?? "09:00") + build.toleranceMinutes;
      const timezone = rule?.timezone ?? build.office?.timezone ?? "UTC";
      late = rule
        ? lateMinutesForWorkPattern(checkIn, rule, timezone)
        : Math.max(0, zonedMinutes(checkIn, timezone) - threshold);
    }

    let status: MonthlyDayStatus;
    let workHours = 0;
    if (isFuture) {
      status = "FUTURE";
    } else if (build.holidayDates.has(formatDay(date))) {
      status = "HOLIDAY";
    } else if (!scheduled) {
      status = "WEEKEND";
    } else if (!checkIn) {
      status = "ABSENT";
    } else if (!checkOut) {
      status = "INCOMPLETE";
    } else if (checkOut.getTime() < checkIn.getTime()) {
      status = "ANOMALY";
    } else {
      const rawHours = (checkOut.getTime() - checkIn.getTime()) / 3_600_000;
      workHours = roundHours(rawHours > 6 ? rawHours - breakMins / 60 : rawHours);
      status = "PRESENT";
    }

    return {
      date: formatDay(date),
      checkIn: checkIn ? checkIn.toISOString() : null,
      checkOut: checkOut ? checkOut.toISOString() : null,
      workHours,
      late,
      status,
    };
  });

  return build.statusFilter
    ? allDays.filter((day) => day.status === build.statusFilter)
    : allDays;
}

function monthlyTotals(days: MonthlyDay[]): { hours: number; late: number; absent: number } {
  return days.reduce(
    (acc, day) => ({
      hours: roundHours(acc.hours + day.workHours),
      late: acc.late + day.late,
      absent: acc.absent + (day.status === "ABSENT" ? 1 : 0),
    }),
    { hours: 0, late: 0, absent: 0 },
  );
}

/**
 * Rekap bulanan per member. Hari libur dari tabel tidak dihitung alpha;
 * akhir pekan dan tanggal setelah hari ini juga bukan alpha. Check-out lebih
 * awal dari check-in dicatat ANOMALY dengan workHours 0 (tidak pernah negatif).
 */
export async function getMonthlyReport(input: MonthlyReportInput): Promise<MonthlyReport> {
  assertWorkspaceReadClaim(input.ctx, input.workspaceId);
  const year = parseYear(input.year);
  const month = parseMonth(input.month);
  if (input.memberId && !isUuid(input.memberId)) {
    throw new HttpError(400, "INVALID_MEMBER", "Parameter memberId tidak valid");
  }
  if (input.divisionId && !isUuid(input.divisionId)) {
    throw new HttpError(400, "INVALID_DIVISION", "Parameter divisionId tidak valid");
  }
  if (input.positionId && !isUuid(input.positionId)) {
    throw new HttpError(400, "INVALID_POSITION", "Parameter positionId tidak valid");
  }

  const statusFilter = input.status?.trim().toUpperCase();
  if (statusFilter && !(MONTHLY_STATUSES as readonly string[]).includes(statusFilter)) {
    throw new HttpError(400, "INVALID_STATUS", "Status rekap tidak valid");
  }
  const limit = pageValue(input.limit, REPORT_LIST_LIMIT_DEFAULT, 1, REPORT_LIST_LIMIT_MAX);
  const offset = pageValue(input.offset, 0, 0, Number.MAX_SAFE_INTEGER);
  const range = dayRange(input.from, input.to);

  const start = new Date(Date.UTC(year, month - 1, 1));
  const end = new Date(Date.UTC(year, month, 1));
  const today = startOfUtcDay(input.now ?? new Date());
  const tolerance = lateToleranceMinutes();
  const breakMins = breakMinutes();

  return withTenant(input.ctx, async (db) => {
    const [members, logs, holidays, office, patternAssignments] = await Promise.all([
      db.workspaceMember.findMany({
        where: {
          status: "ACTIVE",
          ...(input.memberId ? { id: input.memberId } : {}),
          ...(input.divisionId ? { divisionId: input.divisionId } : {}),
          ...(input.positionId ? { positionId: input.positionId } : {}),
        },
        include: {
          user: { select: { name: true } },
          division: { select: { name: true } },
        },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      }),
      db.attendanceLog.findMany({
        where: {
          workDate: { gte: start, lt: end },
          type: { in: ["CHECK_IN", "CHECK_OUT"] },
        },
        orderBy: [{ timestampServer: "asc" }, { id: "asc" }],
      }),
      db.workspaceHoliday.findMany({ where: { date: { gte: start, lt: end } } }),
      db.officeLocation.findFirst({
        where: { isActive: true },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      }),
      db.workPatternAssignment.findMany({
        include: { workPattern: { include: { days: true } } },
      }),
    ]);

    const holidayDates = new Set(holidays.map((holiday) => formatDay(holiday.date)));
    const byMemberDay = indexLogs(logs);
    const workPatternIndex = createWorkPatternRuleIndex(patternAssignments);
    const rangeStart =
      range.fromDate && range.fromDate.getTime() > start.getTime()
        ? range.fromDate
        : start;
    const rangeEnd =
      range.toDate && range.toDate.getTime() < end.getTime()
        ? new Date(range.toDate.getTime() + 86_400_000)
        : end;
    const dates: Date[] = [];
    for (let cursor = rangeStart; cursor < rangeEnd; cursor = new Date(cursor.getTime() + 86_400_000)) {
      dates.push(cursor);
    }

    const resultMembers = members.map((member) => {
      const days = buildMonthlyDays(member.id, byMemberDay, {
        dates,
        holidayDates,
        today,
        workPatternIndex,
        toleranceMinutes: tolerance,
        office,
        statusFilter,
      });
      const totals = monthlyTotals(days);
      return {
        memberId: member.id,
        name: member.user.name,
        divisionName: member.division?.name ?? null,
        days,
        totalWorkHours: totals.hours,
        totalLate: totals.late,
        totalAbsent: totals.absent,
      };
    });

    return {
      year,
      month,
      timezone: office?.timezone ?? null,
      days: dates.map(formatDay),
      members: resultMembers.slice(offset, offset + limit),
      pagination: { limit, offset, total: resultMembers.length },
    };
  });
}

function csvValue(value: string): string {
  return /[",\n\r]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

const CSV_HEADER = "member_name,date,check_in,check_out,work_hours,late_minutes,status";
const CSV_STREAM_PAGE = 100;

function csvLine(name: string, day: MonthlyDay): string {
  return [
    name,
    day.date,
    day.checkIn ?? "",
    day.checkOut ?? "",
    day.workHours.toFixed(2),
    String(day.late),
    day.status,
  ]
    .map(csvValue)
    .join(",");
}

/** CSV payroll hanya memuat kolom yang disepakati; tanpa foto/koordinat/proof. */
export function monthlyReportToCsv(report: MonthlyReport): { csv: string; rowCount: number } {
  const lines = [CSV_HEADER];
  for (const member of report.members) {
    for (const day of member.days) lines.push(csvLine(member.name, day));
  }
  return { csv: `${lines.join("\r\n")}\r\n`, rowCount: lines.length - 1 };
}

export type CsvExportInput = {
  ctx: TenantContext;
  workspaceId: string;
  year: string | number;
  month: string | number;
  memberId?: string | undefined;
  divisionId?: string | undefined;
  positionId?: string | undefined;
  from?: string | undefined;
  to?: string | undefined;
  status?: string | undefined;
  ip?: string | null;
  userAgent?: string | null;
  now?: Date | undefined;
};

export type CsvExportResult = {
  filename: string;
  csv: string;
  rowCount: number;
};

export async function exportMonthlyCsv(input: CsvExportInput): Promise<CsvExportResult> {
  const report = await getMonthlyReport({
    ...input,
    limit: REPORT_LIST_LIMIT_MAX,
    offset: 0,
  });
  const { csv, rowCount } = monthlyReportToCsv(report);
  const format = "csv";
  const filename = `rekap-${report.year}-${String(report.month).padStart(2, "0")}.csv`;

  await withTenant(input.ctx, async (db) => {
    await writeAudit(
      {
        tenantId: input.ctx.tenantId,
        actorType: "USER",
        actorUserId: input.ctx.userId,
        actorMemberId: input.ctx.memberId,
        action: "report.export",
        resourceType: "report",
        resourceId: input.workspaceId,
        // Tanpa nama member, email, jam, atau data pribadi lain.
        metadata: {
          year: report.year,
          month: report.month,
          format,
          rowCount,
          resourceId: input.workspaceId,
        },
        ip: input.ip ?? null,
        userAgent: input.userAgent ?? null,
      },
      db as never,
    );
  });

  return { filename, csv, rowCount };
}

export type CsvStreamResult = {
  filename: string;
  stream: ReadableStream<Uint8Array>;
};

/**
 * Export CSV streaming: member dibaca per halaman (cursor id) dan hanya satu
 * halaman log yang dihitung sekaligus, sehingga memori tidak tumbuh mengikuti
 * ukuran workspace. Audit ditulis sekali sebelum stream dimulai.
 */
export async function streamMonthlyCsv(input: CsvExportInput): Promise<CsvStreamResult> {
  assertWorkspaceReadClaim(input.ctx, input.workspaceId);
  const year = parseYear(input.year);
  const month = parseMonth(input.month);
  if (input.memberId && !isUuid(input.memberId)) {
    throw new HttpError(400, "INVALID_MEMBER", "Parameter memberId tidak valid");
  }
  if (input.divisionId && !isUuid(input.divisionId)) {
    throw new HttpError(400, "INVALID_DIVISION", "Parameter divisionId tidak valid");
  }
  if (input.positionId && !isUuid(input.positionId)) {
    throw new HttpError(400, "INVALID_POSITION", "Parameter positionId tidak valid");
  }
  const statusFilter = input.status?.trim().toUpperCase();
  if (statusFilter && !(MONTHLY_STATUSES as readonly string[]).includes(statusFilter)) {
    throw new HttpError(400, "INVALID_STATUS", "Status rekap tidak valid");
  }
  const range = dayRange(input.from, input.to);
  const start = new Date(Date.UTC(year, month - 1, 1));
  const end = new Date(Date.UTC(year, month, 1));
  const today = startOfUtcDay(input.now ?? new Date());
  const tolerance = lateToleranceMinutes();
  const rangeStart =
    range.fromDate && range.fromDate.getTime() > start.getTime() ? range.fromDate : start;
  const rangeEnd =
    range.toDate && range.toDate.getTime() < end.getTime()
      ? new Date(range.toDate.getTime() + 86_400_000)
      : end;
  const dates: Date[] = [];
  for (let day = rangeStart; day < rangeEnd; day = new Date(day.getTime() + 86_400_000)) {
    dates.push(day);
  }

  const [holidays, office, patternAssignments] = await withTenant(input.ctx, async (db) =>
    Promise.all([
      db.workspaceHoliday.findMany({ where: { date: { gte: start, lt: end } } }),
      db.officeLocation.findFirst({
        where: { isActive: true },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      }),
      db.workPatternAssignment.findMany({
        include: { workPattern: { include: { days: true } } },
      }),
    ]),
  );
  const build: MonthlyBuild = {
    dates,
    holidayDates: new Set(holidays.map((holiday) => formatDay(holiday.date))),
    today,
    workPatternIndex: createWorkPatternRuleIndex(patternAssignments),
    toleranceMinutes: tolerance,
    office,
    statusFilter,
  };

  await withTenant(input.ctx, async (db) => {
    await writeAudit(
      {
        tenantId: input.ctx.tenantId,
        actorType: "USER",
        actorUserId: input.ctx.userId,
        actorMemberId: input.ctx.memberId,
        action: "report.export",
        resourceType: "report",
        resourceId: input.workspaceId,
        // Tanpa nama member, email, jam, atau data pribadi lain.
        metadata: { year, month, format: "csv", resourceId: input.workspaceId },
        ip: input.ip ?? null,
        userAgent: input.userAgent ?? null,
      },
      db as never,
    );
  });

  const encoder = new TextEncoder();
  const ctx = input.ctx;
  const memberId = input.memberId;
  let cursor: string | null = null;
  let finished = false;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(`${CSV_HEADER}\r\n`));
    },
    async pull(controller) {
      if (finished) {
        controller.close();
        return;
      }
      const chunk = await withTenant(ctx, async (db) => {
        const members = await db.workspaceMember.findMany({
          where: {
            status: "ACTIVE",
            ...(memberId ? { id: memberId } : {}),
            ...(input.divisionId ? { divisionId: input.divisionId } : {}),
            ...(input.positionId ? { positionId: input.positionId } : {}),
            ...(cursor ? { id: { gt: cursor } } : {}),
          },
          include: { user: { select: { name: true } } },
          orderBy: [{ id: "asc" }],
          take: CSV_STREAM_PAGE,
        });
        if (members.length === 0) {
          finished = true;
          return "";
        }
        cursor = members[members.length - 1]!.id;
        if (members.length < CSV_STREAM_PAGE) finished = true;

        const logs = await db.attendanceLog.findMany({
          where: {
            workDate: { gte: start, lt: end },
            type: { in: ["CHECK_IN", "CHECK_OUT"] },
            memberId: { in: members.map((member) => member.id) },
          },
          orderBy: [{ timestampServer: "asc" }, { id: "asc" }],
        });
        const byMemberDay = indexLogs(logs);
        const lines: string[] = [];
        for (const member of members) {
          for (const day of buildMonthlyDays(member.id, byMemberDay, build)) {
            lines.push(csvLine(member.user.name, day));
          }
        }
        return lines.length > 0 ? `${lines.join("\r\n")}\r\n` : "";
      });
      if (chunk) controller.enqueue(encoder.encode(chunk));
      if (finished) controller.close();
    },
  });

  return {
    filename: `rekap-${year}-${String(month).padStart(2, "0")}.csv`,
    stream,
  };
}

export type LateStats = {
  totalLate: number;
  lateByDay: Array<{ date: string; count: number }>;
  lateByMember: Array<{ memberId: string; name: string; count: number }>;
  averageLateMinutes: number;
};

export async function getLateStats(input: MonthlyReportInput): Promise<LateStats> {
  const report = await getMonthlyReport(input);
  const dayCounts = new Map<string, number>();
  const memberCounts = new Map<string, { name: string; count: number }>();
  let totalLate = 0;
  let totalMinutes = 0;

  for (const member of report.members) {
    for (const day of member.days) {
      if (day.late <= 0) continue;
      totalLate += 1;
      totalMinutes += day.late;
      dayCounts.set(day.date, (dayCounts.get(day.date) ?? 0) + 1);
      const entry = memberCounts.get(member.memberId) ?? {
        name: member.name,
        count: 0,
      };
      entry.count += 1;
      memberCounts.set(member.memberId, entry);
    }
  }

  return {
    totalLate,
    lateByDay: [...dayCounts.entries()]
      .map(([date, count]) => ({ date, count }))
      .sort((a, b) => a.date.localeCompare(b.date)),
    lateByMember: [...memberCounts.entries()]
      .map(([memberId, entry]) => ({ memberId, name: entry.name, count: entry.count }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
    averageLateMinutes: totalLate === 0 ? 0 : Math.round(totalMinutes / totalLate),
  };
}
