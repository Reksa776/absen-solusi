/**
 * Pola Kerja adalah sumber utama jam kerja. Hari memakai pemetaan JavaScript:
 * Minggu=0, Senin=1, ..., Sabtu=6. Jadwal Shift lama tidak dipakai lagi.
 */

export const WORK_PATTERN_DAY_LABELS: Readonly<Record<number, string>> = {
  0: "Minggu",
  1: "Senin",
  2: "Selasa",
  3: "Rabu",
  4: "Kamis",
  5: "Jumat",
  6: "Sabtu",
};

/** Urutan tampilan Senin-Minggu. */
export const WORK_PATTERN_DAY_NUMBERS = [1, 2, 3, 4, 5, 6, 0] as const;

export function workPatternDayLabel(dayOfWeek: number): string {
  return WORK_PATTERN_DAY_LABELS[dayOfWeek] ?? `Hari ${dayOfWeek}`;
}

export function compareWorkPatternDays(
  left: { dayOfWeek: number },
  right: { dayOfWeek: number },
): number {
  const order = (day: number) => (day === 0 ? 7 : day);
  return order(left.dayOfWeek) - order(right.dayOfWeek);
}

export function workPatternDayOfWeek(date: Date): number {
  return date.getUTCDay();
}

export function isWeekendDay(dayOfWeek: number): boolean {
  return dayOfWeek === 0 || dayOfWeek === 6;
}

export function timeToMinutes(value: string): number {
  return Number(value.slice(0, 2)) * 60 + Number(value.slice(3, 5));
}

export function isOvernightPattern(startTime: string, endTime: string): boolean {
  return timeToMinutes(endTime) < timeToMinutes(startTime);
}

export function zonedMinutesOfDay(date: Date, timeZone: string): number {
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

export type WorkPatternRule = {
  workPatternId: string;
  workPatternName: string;
  timezone: string;
  dayOfWeek: number;
  isWorkday: boolean;
  startTime: string;
  endTime: string;
  earliestCheckInMinutes: number;
  lateToleranceMinutes: number;
};

export type WorkPatternRuleIndex = Map<
  string,
  {
    workPatternId: string;
    workPatternName: string;
    timezone: string;
    days: Map<number, WorkPatternRule>;
  }
>;

export type WorkPatternRuleSource = {
  memberId: string;
  workPattern: {
    id: string;
    name: string;
    timezone: string;
    days: Array<{
      dayOfWeek: number;
      isWorkday: boolean;
      startTime: string;
      endTime: string;
      earliestCheckInMinutes: number;
      lateToleranceMinutes: number;
    }>;
  };
};

export function createWorkPatternRuleIndex(
  rows: readonly WorkPatternRuleSource[],
): WorkPatternRuleIndex {
  const index: WorkPatternRuleIndex = new Map();
  for (const row of rows) {
    const days = new Map<number, WorkPatternRule>();
    for (const day of row.workPattern.days) {
      days.set(day.dayOfWeek, {
        workPatternId: row.workPattern.id,
        workPatternName: row.workPattern.name,
        timezone: row.workPattern.timezone,
        dayOfWeek: day.dayOfWeek,
        isWorkday: day.isWorkday,
        startTime: day.startTime,
        endTime: day.endTime,
        earliestCheckInMinutes: day.earliestCheckInMinutes,
        lateToleranceMinutes: day.lateToleranceMinutes,
      });
    }
    index.set(row.memberId, {
      workPatternId: row.workPattern.id,
      workPatternName: row.workPattern.name,
      timezone: row.workPattern.timezone,
      days,
    });
  }
  return index;
}

export function workPatternRuleFor(
  index: WorkPatternRuleIndex,
  memberId: string,
  date: Date,
): WorkPatternRule | null {
  return index.get(memberId)?.days.get(workPatternDayOfWeek(date)) ?? null;
}

export function workPatternFor(
  index: WorkPatternRuleIndex,
  memberId: string,
): { workPatternId: string; workPatternName: string; timezone: string } | null {
  const entry = index.get(memberId);
  return entry
    ? {
        workPatternId: entry.workPatternId,
        workPatternName: entry.workPatternName,
        timezone: entry.timezone,
      }
    : null;
}

/** Null berarti karyawan belum punya Pola Kerja (fallback Senin-Jumat). */
export function workPatternWorkingDays(
  index: WorkPatternRuleIndex,
  memberId: string,
): ReadonlySet<number> | null {
  const entry = index.get(memberId);
  if (!entry) return null;
  return new Set(
    [...entry.days.values()]
      .filter((day) => day.isWorkday)
      .map((day) => day.dayOfWeek),
  );
}

export function isScheduledWorkday(
  rule: WorkPatternRule | null,
  dayOfWeek: number,
): boolean {
  return rule ? rule.isWorkday : !isWeekendDay(dayOfWeek);
}

/** Keterlambatan setelah toleransi Pola Kerja hari tersebut. */
export function lateMinutesForWorkPattern(
  checkIn: Date,
  rule: Pick<WorkPatternRule, "startTime" | "endTime" | "lateToleranceMinutes">,
  timeZone: string,
): number {
  const start = timeToMinutes(rule.startTime);
  const end = timeToMinutes(rule.endTime);
  let actual = zonedMinutesOfDay(checkIn, timeZone);
  if (isOvernightPattern(rule.startTime, rule.endTime) && actual < end) {
    actual += 24 * 60;
  }
  return Math.max(0, actual - start - rule.lateToleranceMinutes);
}

/** Menit pulang lebih awal dari jam pulang Pola Kerja. */
export function earlyLeaveMinutesForWorkPattern(
  checkOut: Date,
  rule: Pick<WorkPatternRule, "startTime" | "endTime">,
  timeZone: string,
): number {
  const start = timeToMinutes(rule.startTime);
  const end = timeToMinutes(rule.endTime);
  const overnight = isOvernightPattern(rule.startTime, rule.endTime);
  let actual = zonedMinutesOfDay(checkOut, timeZone);
  let expectedEnd = end;
  if (overnight) {
    expectedEnd += 24 * 60;
    if (actual < end) actual += 24 * 60;
  }
  return Math.max(0, expectedEnd - actual);
}

export type AttendanceScheduleStatus = "ON_TIME" | "LATE" | "EARLY_LEAVE" | "OFF_DAY";

export type AttendanceScheduleEvaluation = {
  status: AttendanceScheduleStatus;
  lateMinutes: number;
  earlyLeaveMinutes: number;
};

/**
 * Non-workday tetap boleh dicatat (misalnya lembur), tetapi statusnya OFF_DAY
 * dan aturan toleransi hari kerja tidak diterapkan.
 */
export function evaluateAttendanceSchedule(input: {
  type: "CHECK_IN" | "CHECK_OUT";
  at: Date;
  rule: WorkPatternRule | null;
  timezone: string;
}): AttendanceScheduleEvaluation {
  if (!input.rule || !input.rule.isWorkday) {
    return {
      status: input.rule ? "OFF_DAY" : "ON_TIME",
      lateMinutes: 0,
      earlyLeaveMinutes: 0,
    };
  }
  if (input.type === "CHECK_IN") {
    const lateMinutes = lateMinutesForWorkPattern(input.at, input.rule, input.timezone);
    return {
      status: lateMinutes > 0 ? "LATE" : "ON_TIME",
      lateMinutes,
      earlyLeaveMinutes: 0,
    };
  }
  const earlyLeaveMinutes = earlyLeaveMinutesForWorkPattern(
    input.at,
    input.rule,
    input.timezone,
  );
  return {
    status: earlyLeaveMinutes > 0 ? "EARLY_LEAVE" : "ON_TIME",
    lateMinutes: 0,
    earlyLeaveMinutes,
  };
}
