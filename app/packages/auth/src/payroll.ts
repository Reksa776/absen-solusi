import { withTenant, writeAudit, type TenantContext } from "@absensi/database";

import { HttpError } from "./http.js";
import { parseReportDay, startOfUtcDay } from "./reports.js";
import {
  createShiftRuleIndex,
  lateMinutesForShift,
  shiftRuleFor,
  shiftMinutes,
} from "./shifts.js";
import { assertWorkspaceReadClaim } from "./workspaces.js";

const DAY_MS = 86_400_000;

export type PayrollMemberSummary = {
  memberId: string;
  name: string;
  presentDays: number;
  officeDays: number;
  wfhDays: number;
  holidayDays: number;
  weekendDays: number;
  absentDays: number;
  lateIncidents: number;
  lateMinutes: number;
  workMinutes: number;
  workHours: number;
  overtimeMinutes: number;
  overtimeHours: number;
};

export type PayrollTotals = Omit<PayrollMemberSummary, "memberId" | "name">;

export type PayrollSummary = {
  from: string;
  to: string;
  timezone: string | null;
  members: PayrollMemberSummary[];
  totals: PayrollTotals;
};

export type PayrollSummaryInput = {
  ctx: TenantContext;
  workspaceId: string;
  from: string;
  to: string;
  memberId?: string | undefined;
  now?: Date | undefined;
};

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * DAY_MS);
}

function dayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function roundHours(minutes: number): number {
  return Math.round((minutes / 60) * 100) / 100;
}

function emptyTotals(): PayrollTotals {
  return {
    presentDays: 0,
    officeDays: 0,
    wfhDays: 0,
    holidayDays: 0,
    weekendDays: 0,
    absentDays: 0,
    lateIncidents: 0,
    lateMinutes: 0,
    workMinutes: 0,
    workHours: 0,
    overtimeMinutes: 0,
    overtimeHours: 0,
  };
}

function assertRange(from: Date, to: Date): void {
  if (from.getTime() > to.getTime()) {
    throw new HttpError(400, "INVALID_DATE_RANGE", "Rentang tanggal tidak valid");
  }
  const days = Math.floor((to.getTime() - from.getTime()) / DAY_MS) + 1;
  if (days > 366) {
    throw new HttpError(400, "INVALID_DATE_RANGE", "Rentang payroll maksimal 366 hari");
  }
}

/**
 * Rekap siap payroll. Satu hari dihitung hadir bila ada check-in; hari libur,
 * akhir pekan, dan alpha hanya dihitung untuk hari yang tidak hadir. Lembur
 * hanya mengambil pengajuan APPROVED dengan tanggal di dalam periode.
 */
export async function getPayrollSummary(
  input: PayrollSummaryInput,
): Promise<PayrollSummary> {
  assertWorkspaceReadClaim(input.ctx, input.workspaceId);
  const from = parseReportDay(input.from, "from");
  const to = parseReportDay(input.to, "to");
  assertRange(from, to);
  const endExclusive = addDays(to, 1);
  const today = startOfUtcDay(input.now ?? new Date());

  return withTenant(input.ctx, async (db) => {
    const [members, logs, holidays, office, memberShiftRows, overtimeRows] =
      await Promise.all([
        db.workspaceMember.findMany({
          where: {
            status: "ACTIVE",
            ...(input.memberId ? { id: input.memberId } : {}),
          },
          include: { user: { select: { name: true } } },
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        }),
        db.attendanceLog.findMany({
          where: {
            workDate: { gte: from, lt: endExclusive },
            type: { in: ["CHECK_IN", "CHECK_OUT"] },
            ...(input.memberId ? { memberId: input.memberId } : {}),
          },
          orderBy: [{ timestampServer: "asc" }, { id: "asc" }],
        }),
        db.workspaceHoliday.findMany({
          where: { date: { gte: from, lt: endExclusive } },
        }),
        db.officeLocation.findFirst({
          where: { isActive: true },
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        }),
        db.memberShift.findMany({
          where: {
            OR: [
              { workDate: { gte: from, lt: endExclusive } },
              { workDate: null },
            ],
          },
          include: {
            shift: {
              select: {
                id: true,
                name: true,
                startTime: true,
                endTime: true,
                lateToleranceMinutes: true,
              },
            },
          },
        }),
        db.overtimeRequest.findMany({
          where: {
            status: "APPROVED",
            date: { gte: from, lt: endExclusive },
            ...(input.memberId ? { memberId: input.memberId } : {}),
          },
          select: { memberId: true, durationMinutes: true },
        }),
      ]);

    const holidayDates = new Set(holidays.map((row) => dayKey(row.date)));
    const shiftIndex = createShiftRuleIndex(memberShiftRows);
    const overtimeByMember = new Map<string, number>();
    for (const row of overtimeRows) {
      overtimeByMember.set(
        row.memberId,
        (overtimeByMember.get(row.memberId) ?? 0) + row.durationMinutes,
      );
    }

    const byMemberDay = new Map<
      string,
      { checkIn?: Date; checkOut?: Date; workMode?: string }
    >();
    for (const log of logs) {
      const key = `${log.memberId}:${dayKey(log.workDate)}`;
      const entry = byMemberDay.get(key) ?? {};
      if (log.type === "CHECK_IN" && !entry.checkIn) {
        entry.checkIn = log.timestampServer;
        entry.workMode = log.workMode;
      }
      if (log.type === "CHECK_OUT" && !entry.checkOut) {
        entry.checkOut = log.timestampServer;
      }
      byMemberDay.set(key, entry);
    }

    const dates: Date[] = [];
    for (let cursor = from; cursor < endExclusive; cursor = addDays(cursor, 1)) {
      dates.push(cursor);
    }

    const result = members.map((member) => {
      const summary: PayrollMemberSummary = {
        memberId: member.id,
        name: member.user.name,
        ...emptyTotals(),
      };
      for (const date of dates) {
        if (date.getTime() > today.getTime()) continue;
        const entry = byMemberDay.get(`${member.id}:${dayKey(date)}`);
        const key = dayKey(date);
        const weekday = date.getUTCDay();
        if (entry?.checkIn) {
          summary.presentDays += 1;
          if (entry.workMode === "WFH") summary.wfhDays += 1;
          else summary.officeDays += 1;
          if (entry.checkOut && entry.checkOut.getTime() >= entry.checkIn.getTime()) {
            summary.workMinutes += Math.round(
              (entry.checkOut.getTime() - entry.checkIn.getTime()) / 60_000,
            );
          }
          const rule = shiftRuleFor(shiftIndex, member.id, key);
          if (office) {
            const late = rule
              ? lateMinutesForShift(entry.checkIn, rule, office.timezone)
              : Math.max(
                  0,
                  localMinutes(entry.checkIn, office.timezone) -
                    shiftMinutes(office.workStart) -
                    15,
                );
            if (late > 0) {
              summary.lateIncidents += 1;
              summary.lateMinutes += late;
            }
          }
        } else if (holidayDates.has(key)) {
          summary.holidayDays += 1;
        } else if (weekday === 0 || weekday === 6) {
          summary.weekendDays += 1;
        } else {
          summary.absentDays += 1;
        }
      }
      summary.workHours = roundHours(summary.workMinutes);
      summary.overtimeMinutes = overtimeByMember.get(member.id) ?? 0;
      summary.overtimeHours = roundHours(summary.overtimeMinutes);
      return summary;
    });

    const totals = result.reduce<PayrollTotals>((acc, member) => {
      acc.presentDays += member.presentDays;
      acc.officeDays += member.officeDays;
      acc.wfhDays += member.wfhDays;
      acc.holidayDays += member.holidayDays;
      acc.weekendDays += member.weekendDays;
      acc.absentDays += member.absentDays;
      acc.lateIncidents += member.lateIncidents;
      acc.lateMinutes += member.lateMinutes;
      acc.workMinutes += member.workMinutes;
      acc.overtimeMinutes += member.overtimeMinutes;
      return acc;
    }, emptyTotals());
    totals.workHours = roundHours(totals.workMinutes);
    totals.overtimeHours = roundHours(totals.overtimeMinutes);

    return {
      from: dayKey(from),
      to: dayKey(to),
      timezone: office?.timezone ?? null,
      members: result,
      totals,
    };
  });
}

function localMinutes(date: Date, timeZone: string): number {
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

function csvValue(value: string | number): string {
  const text = String(value);
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export const PAYROLL_CSV_HEADER =
  "member_name,present_days,office_days,wfh_days,holiday_days,weekend_days,absent_days,late_incidents,late_minutes,work_minutes,work_hours,overtime_minutes,overtime_hours";

export function payrollSummaryToCsv(summary: PayrollSummary): {
  csv: string;
  rowCount: number;
} {
  const lines = [PAYROLL_CSV_HEADER];
  for (const member of summary.members) {
    lines.push(
      [
        member.name,
        member.presentDays,
        member.officeDays,
        member.wfhDays,
        member.holidayDays,
        member.weekendDays,
        member.absentDays,
        member.lateIncidents,
        member.lateMinutes,
        member.workMinutes,
        member.workHours,
        member.overtimeMinutes,
        member.overtimeHours,
      ]
        .map(csvValue)
        .join(","),
    );
  }
  return { csv: `${lines.join("\r\n")}\r\n`, rowCount: lines.length - 1 };
}

export type PayrollExportResult = {
  filename: string;
  stream: ReadableStream<Uint8Array>;
  rowCount: number;
};

/** Export streaming dengan audit `report.export` sebelum byte pertama dikirim. */
export async function streamPayrollCsv(input: PayrollSummaryInput & {
  ip?: string | null;
  userAgent?: string | null;
}): Promise<PayrollExportResult> {
  const summary = await getPayrollSummary(input);
  const { csv, rowCount } = payrollSummaryToCsv(summary);

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
        metadata: {
          report: "payroll_summary",
          from: summary.from,
          to: summary.to,
          format: "csv",
          rowCount,
          resourceId: input.workspaceId,
        },
        ip: input.ip ?? null,
        userAgent: input.userAgent ?? null,
      },
      db as never,
    );
  });

  const bytes = new TextEncoder().encode(csv);
  const chunkSize = 8 * 1024;
  let offset = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (offset >= bytes.byteLength) {
        controller.close();
        return;
      }
      controller.enqueue(bytes.slice(offset, offset + chunkSize));
      offset += chunkSize;
    },
  });
  return {
    filename: `payroll-${summary.from}-${summary.to}.csv`,
    stream,
    rowCount,
  };
}
