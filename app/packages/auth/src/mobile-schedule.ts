import { withTenant, type TenantContext } from "@absensi/database";

import {
  WORK_PATTERN_DAY_LABELS,
  WORK_PATTERN_DAY_NUMBERS,
} from "./work-pattern-schedule.js";

export type MobileScheduleDay = {
  dayOfWeek: number;
  label: string;
  isWorkday: boolean;
  startTime: string;
  endTime: string;
  earliestCheckInMinutes: number;
  lateToleranceMinutes: number;
};

export type MobileScheduleHoliday = {
  id: string;
  date: string;
  name: string;
  type: "NATIONAL" | "COMPANY";
};

export type MobileSchedule = {
  office: {
    id: string;
    name: string;
    timezone: string;
    radiusMeters: number;
    workStart: string;
    workEnd: string;
  } | null;
  workPattern: {
    id: string;
    name: string;
    timezone: string;
  } | null;
  weekly: MobileScheduleDay[];
  holidays: MobileScheduleHoliday[];
};

const NATIONAL_HOLIDAY = /\b(nasional|cuti bersama)\b/i;

/**
 * Kolom jenis libur belum ada di skema, jadi jenis diturunkan dari nama yang
 * ditulis admin ("Libur Nasional ..." / "Cuti Bersama ...").
 */
export function holidayTypeForName(name: string): "NATIONAL" | "COMPANY" {
  return NATIONAL_HOLIDAY.test(name) ? "NATIONAL" : "COMPANY";
}

function dayString(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Jadwal mingguan Pola Kerja aktif + hari libur tahun berjalan untuk mobile. */
export async function getMobileSchedule(input: {
  ctx: TenantContext;
  year?: number | undefined;
}): Promise<MobileSchedule> {
  const year = input.year ?? new Date().getUTCFullYear();

  const { office, assignment, holidays } = await withTenant(input.ctx, async (db) => {
    const [office, assignment, holidays] = await Promise.all([
      db.officeLocation.findFirst({
        where: { isActive: true },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      }),
      db.workPatternAssignment.findFirst({
        where: { memberId: input.ctx.memberId },
        include: { workPattern: { include: { days: true } } },
      }),
      db.workspaceHoliday.findMany({
        where: {
          date: {
            gte: new Date(Date.UTC(year, 0, 1)),
            lt: new Date(Date.UTC(year + 1, 0, 1)),
          },
        },
        orderBy: [{ date: "asc" }, { id: "asc" }],
      }),
    ]);
    return { office, assignment, holidays };
  });

  const pattern = assignment?.workPattern ?? null;
  const dayByNumber = new Map(
    (pattern?.days ?? []).map((day) => [day.dayOfWeek, day]),
  );

  return {
    office: office
      ? {
          id: office.id,
          name: office.name,
          timezone: office.timezone,
          radiusMeters: office.radiusMeters,
          workStart: office.workStart,
          workEnd: office.workEnd,
        }
      : null,
    workPattern: pattern
      ? {
          id: pattern.id,
          name: pattern.name,
          timezone: pattern.timezone,
        }
      : null,
    weekly: WORK_PATTERN_DAY_NUMBERS.map((dayOfWeek) => {
      const configured = dayByNumber.get(dayOfWeek);
      const fallbackWorkday = dayOfWeek >= 1 && dayOfWeek <= 5;
      return {
        dayOfWeek,
        label: WORK_PATTERN_DAY_LABELS[dayOfWeek] ?? `Hari ${dayOfWeek}`,
        isWorkday: configured?.isWorkday ?? fallbackWorkday,
        // Tanpa penugasan, jam kantor menjadi fallback yang eksplisit.
        startTime: configured?.startTime ?? office?.workStart ?? "09:00",
        endTime: configured?.endTime ?? office?.workEnd ?? "17:00",
        earliestCheckInMinutes: configured?.earliestCheckInMinutes ?? 120,
        lateToleranceMinutes: configured?.lateToleranceMinutes ?? 0,
      };
    }),
    holidays: holidays.map((row) => ({
      id: row.id,
      date: dayString(row.date),
      name: row.name,
      type: holidayTypeForName(row.name),
    })),
  };
}
