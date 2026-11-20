import { withTenant, type TenantContext } from "@absensi/database";

export type MobileScheduleDay = {
  dayOfWeek: number;
  label: string;
  isWorkday: boolean;
  startTime: string;
  endTime: string;
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
  shift: {
    id: string;
    name: string;
    startTime: string;
    endTime: string;
    lateToleranceMinutes: number;
  } | null;
  weekly: MobileScheduleDay[];
  holidays: MobileScheduleHoliday[];
};

const DAY_LABELS = [
  "Senin",
  "Selasa",
  "Rabu",
  "Kamis",
  "Jumat",
  "Sabtu",
  "Minggu",
];

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

/** Jadwal mingguan karyawan + hari libur tahun berjalan untuk aplikasi mobile. */
export async function getMobileSchedule(input: {
  ctx: TenantContext;
  year?: number | undefined;
}): Promise<MobileSchedule> {
  const year = input.year ?? new Date().getUTCFullYear();

  const { office, assignment, holidays } = await withTenant(input.ctx, async (db) => {
    const [office, defaultAssignment, datedAssignment, holidays] = await Promise.all([
      db.officeLocation.findFirst({
        where: { isActive: true },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      }),
      db.memberShift.findFirst({
        where: { memberId: input.ctx.memberId, workDate: null },
        include: { shift: true },
        orderBy: { createdAt: "asc" },
      }),
      db.memberShift.findFirst({
        where: { memberId: input.ctx.memberId, workDate: { not: null } },
        include: { shift: true },
        orderBy: [{ workDate: "desc" }, { createdAt: "desc" }],
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
    return {
      office,
      assignment: defaultAssignment ?? datedAssignment,
      holidays,
    };
  });

  const shift = assignment?.shift ?? null;
  const startTime = shift?.startTime ?? office?.workStart ?? "09:00";
  const endTime = shift?.endTime ?? office?.workEnd ?? "17:00";
  const lateToleranceMinutes = shift?.lateToleranceMinutes ?? 0;

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
    shift: shift
      ? {
          id: shift.id,
          name: shift.name,
          startTime: shift.startTime,
          endTime: shift.endTime,
          lateToleranceMinutes: shift.lateToleranceMinutes,
        }
      : null,
    weekly: DAY_LABELS.map((label, index) => ({
      dayOfWeek: index + 1,
      label,
      isWorkday: index < 5,
      startTime,
      endTime,
      lateToleranceMinutes,
    })),
    holidays: holidays.map((row) => ({
      id: row.id,
      date: dayString(row.date),
      name: row.name,
      type: holidayTypeForName(row.name),
    })),
  };
}
