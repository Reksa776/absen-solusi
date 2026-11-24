import { isUuid, withTenant, writeAudit, type TenantContext } from "@absensi/database";

import { HttpError } from "./http.js";
import {
  createWorkPatternRuleIndex,
  isScheduledWorkday,
  lateMinutesForWorkPattern,
  timeToMinutes,
  workPatternRuleFor,
} from "./work-pattern-schedule.js";
import { parseReportDay, startOfUtcDay } from "./reports.js";
import { assertWorkspaceReadClaim } from "./workspaces.js";

const DAY_MS = 86_400_000;

export type AttendancePeriodMember = {
  memberId: string;
  name: string;
  divisionName: string | null;
  presentDays: number;
  onTimeDays: number;
  lateMinutes: number;
  earlyLeaveDays: number;
  permitDays: number;
  leaveDays: number;
  outOfTownDays: number;
  absentDays: number;
};

export type AttendancePeriodTotals = Omit<
  AttendancePeriodMember,
  "memberId" | "name" | "divisionName"
>;

export type AttendancePeriodSummary = {
  startDate: string;
  endDate: string;
  timezone: string | null;
  members: AttendancePeriodMember[];
  totals: AttendancePeriodTotals;
};

export type AttendancePeriodInput = {
  ctx: TenantContext;
  workspaceId: string;
  startDate: string;
  endDate: string;
  memberId?: string | undefined;
  now?: Date | undefined;
};

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * DAY_MS);
}

function dayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function assertRange(start: Date, end: Date): void {
  if (start.getTime() > end.getTime()) {
    throw new HttpError(400, "INVALID_DATE_RANGE", "Rentang tanggal tidak valid");
  }
  const days = Math.floor((end.getTime() - start.getTime()) / DAY_MS) + 1;
  if (days > 366) {
    throw new HttpError(400, "INVALID_DATE_RANGE", "Rentang maksimal 366 hari");
  }
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

function emptyTotals(): AttendancePeriodTotals {
  return {
    presentDays: 0,
    onTimeDays: 0,
    lateMinutes: 0,
    earlyLeaveDays: 0,
    permitDays: 0,
    leaveDays: 0,
    outOfTownDays: 0,
    absentDays: 0,
  };
}

function addDateKeys(target: Set<string>, start: Date, end: Date, from: Date, to: Date): void {
  const first = start.getTime() < from.getTime() ? from : start;
  const last = end.getTime() > to.getTime() ? to : end;
  for (let cursor = first; cursor.getTime() <= last.getTime(); cursor = addDays(cursor, 1)) {
    target.add(dayKey(cursor));
  }
}

/**
 * Rekap periode lintas bulan untuk cut-off payroll. Kategori hari saling
 * eksklusif: hadir menang atas cuti/izin, lalu cuti/izin, lalu alpha.
 */
export async function getAttendancePeriodSummary(
  input: AttendancePeriodInput,
): Promise<AttendancePeriodSummary> {
  assertWorkspaceReadClaim(input.ctx, input.workspaceId);
  const start = parseReportDay(input.startDate, "startDate");
  const end = parseReportDay(input.endDate, "endDate");
  assertRange(start, end);
  if (input.memberId && !isUuid(input.memberId)) {
    throw new HttpError(400, "INVALID_MEMBER", "Parameter memberId tidak valid");
  }
  const endExclusive = addDays(end, 1);
  const today = startOfUtcDay(input.now ?? new Date());

  return withTenant(input.ctx, async (db) => {
    const [members, logs, holidays, office, patternAssignments, leaves, permits] =
      await Promise.all([
        db.workspaceMember.findMany({
          where: {
            status: "ACTIVE",
            ...(input.memberId ? { id: input.memberId } : {}),
          },
          include: {
            user: { select: { name: true } },
            division: { select: { name: true } },
          },
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        }),
        db.attendanceLog.findMany({
          where: {
            workDate: { gte: start, lt: endExclusive },
            type: { in: ["CHECK_IN", "CHECK_OUT"] },
            ...(input.memberId ? { memberId: input.memberId } : {}),
          },
          orderBy: [{ timestampServer: "asc" }, { id: "asc" }],
        }),
        db.workspaceHoliday.findMany({
          where: { date: { gte: start, lt: endExclusive } },
        }),
        db.officeLocation.findFirst({
          where: { isActive: true },
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        }),
        db.workPatternAssignment.findMany({
          ...(input.memberId ? { where: { memberId: input.memberId } } : {}),
          include: { workPattern: { include: { days: true } } },
        }),
        db.leaveRequest.findMany({
          where: {
            status: "APPROVED",
            startDate: { lte: end },
            endDate: { gte: start },
            ...(input.memberId ? { memberId: input.memberId } : {}),
          },
          select: { memberId: true, startDate: true, endDate: true },
        }),
        db.workPermit.findMany({
          where: {
            status: "APPROVED",
            startDate: { lte: end },
            endDate: { gte: start },
            ...(input.memberId ? { memberId: input.memberId } : {}),
          },
          select: { memberId: true, startDate: true, endDate: true },
        }),
      ]);

    const holidayDates = new Set(holidays.map((row) => dayKey(row.date)));
    const patternIndex = createWorkPatternRuleIndex(patternAssignments);

    const byMemberDay = new Map<
      string,
      { checkIn?: Date; checkOut?: Date; workMode?: string; approved?: boolean }
    >();
    for (const log of logs) {
      const key = `${log.memberId}:${dayKey(log.workDate)}`;
      const entry = byMemberDay.get(key) ?? {};
      if (log.type === "CHECK_IN" && !entry.checkIn) {
        entry.checkIn = log.timestampServer;
        entry.workMode = log.workMode;
        entry.approved = log.approvalStatus === "APPROVED";
      }
      if (log.type === "CHECK_OUT" && !entry.checkOut) {
        entry.checkOut = log.timestampServer;
      }
      byMemberDay.set(key, entry);
    }

    const leaveByMember = new Map<string, Set<string>>();
    for (const row of leaves) {
      const keys = leaveByMember.get(row.memberId) ?? new Set<string>();
      addDateKeys(keys, row.startDate, row.endDate, start, end);
      leaveByMember.set(row.memberId, keys);
    }
    const permitByMember = new Map<string, Set<string>>();
    for (const row of permits) {
      const keys = permitByMember.get(row.memberId) ?? new Set<string>();
      addDateKeys(keys, row.startDate, row.endDate, start, end);
      permitByMember.set(row.memberId, keys);
    }

    const dates: Date[] = [];
    for (let cursor = start; cursor < endExclusive; cursor = addDays(cursor, 1)) {
      dates.push(cursor);
    }

    const result = members.map((member) => {
      const summary: AttendancePeriodMember = {
        memberId: member.id,
        name: member.user.name,
        divisionName: member.division?.name ?? null,
        ...emptyTotals(),
      };
      const leaveDates = leaveByMember.get(member.id) ?? new Set<string>();
      const permitDates = permitByMember.get(member.id) ?? new Set<string>();

      for (const date of dates) {
        if (date.getTime() > today.getTime()) continue;
        const key = dayKey(date);
        const entry = byMemberDay.get(`${member.id}:${key}`);
        const rule = workPatternRuleFor(patternIndex, member.id, date);
        const scheduled = isScheduledWorkday(rule, date.getUTCDay());

        if (entry?.checkIn) {
          summary.presentDays += 1;
          const timezone = rule?.timezone ?? office?.timezone ?? "UTC";
          let late = 0;
          if (rule) {
            late = lateMinutesForWorkPattern(entry.checkIn, rule, timezone);
          } else if (office) {
            late = Math.max(
              0,
              localMinutes(entry.checkIn, timezone) -
                timeToMinutes(office.workStart) -
                15,
            );
          }
          if (late > 0) summary.lateMinutes += late;
          else summary.onTimeDays += 1;

          if (entry.checkOut && (rule || office)) {
            const timezone = rule?.timezone ?? office?.timezone ?? "UTC";
            const startMinutes = rule ? timeToMinutes(rule.startTime) : timeToMinutes(office!.workStart);
            const endMinutes = rule ? timeToMinutes(rule.endTime) : timeToMinutes(office!.workEnd);
            let outMinutes = localMinutes(entry.checkOut, timezone);
            if (endMinutes <= startMinutes && outMinutes < startMinutes) outMinutes += 1440;
            if (outMinutes < endMinutes) summary.earlyLeaveDays += 1;
          }
          if (entry.workMode === "OUT_OF_TOWN" && entry.approved) {
            summary.outOfTownDays += 1;
          }
          continue;
        }

        if (!scheduled || holidayDates.has(key)) continue;
        if (leaveDates.has(key)) {
          summary.leaveDays += 1;
        } else if (permitDates.has(key)) {
          summary.permitDays += 1;
        } else {
          summary.absentDays += 1;
        }
      }
      return summary;
    });

    const totals = result.reduce<AttendancePeriodTotals>((acc, member) => {
      acc.presentDays += member.presentDays;
      acc.onTimeDays += member.onTimeDays;
      acc.lateMinutes += member.lateMinutes;
      acc.earlyLeaveDays += member.earlyLeaveDays;
      acc.permitDays += member.permitDays;
      acc.leaveDays += member.leaveDays;
      acc.outOfTownDays += member.outOfTownDays;
      acc.absentDays += member.absentDays;
      return acc;
    }, emptyTotals());

    return {
      startDate: dayKey(start),
      endDate: dayKey(end),
      timezone: office?.timezone ?? null,
      members: result,
      totals,
    };
  });
}

function csvValue(value: string | number): string {
  const text = String(value);
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export const ATTENDANCE_PERIOD_CSV_HEADER =
  "member_name,division,present_days,on_time_days,late_minutes,early_leave_days,permit_days,leave_days,out_of_town_days,absent_days";

export function attendancePeriodToCsv(summary: AttendancePeriodSummary): {
  csv: string;
  rowCount: number;
} {
  const lines = [ATTENDANCE_PERIOD_CSV_HEADER];
  for (const member of summary.members) {
    lines.push(
      [
        member.name,
        member.divisionName ?? "",
        member.presentDays,
        member.onTimeDays,
        member.lateMinutes,
        member.earlyLeaveDays,
        member.permitDays,
        member.leaveDays,
        member.outOfTownDays,
        member.absentDays,
      ]
        .map(csvValue)
        .join(","),
    );
  }
  return { csv: `${lines.join("\r\n")}\r\n`, rowCount: lines.length - 1 };
}

export async function exportAttendancePeriodCsv(
  input: AttendancePeriodInput & {
    ip?: string | null;
    userAgent?: string | null;
  },
): Promise<{ filename: string; csv: string; rowCount: number }> {
  const summary = await getAttendancePeriodSummary(input);
  const { csv, rowCount } = attendancePeriodToCsv(summary);
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
          report: "attendance_period",
          startDate: summary.startDate,
          endDate: summary.endDate,
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
  return {
    filename: `ringkasan-kehadiran-${summary.startDate}-${summary.endDate}.csv`,
    csv,
    rowCount,
  };
}
