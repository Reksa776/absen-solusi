/**
 * Scheduler worker: keputusan "jam berapa reminder dikirim" dipisah dari loop
 * dan akses database agar dapat diuji tanpa timer maupun DB.
 */

export type ReminderType = "CHECK_IN" | "LATE" | "CHECK_OUT";

export type SchedulableOffice = {
  workStart: string;
  workEnd: string;
  timezone: string;
};

export type SchedulableShift = SchedulableOffice & {
  id: string;
  lateToleranceMinutes: number;
};

export type SchedulableWorkspace = {
  id: string;
  office: SchedulableOffice | null;
  shifts?: SchedulableShift[];
};

export const DEFAULT_INTERVAL_MS = 60_000;
export const CHECK_IN_LEAD_MINUTES = 30;
export const DEFAULT_LATE_TOLERANCE_MINUTES = 15;
export const REMINDER_WINDOW_MINUTES = 5;

type Clock = { dateKey: string; minutes: number };

function clockMinutes(value: string): number {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value);
  if (!match) return Number.NaN;
  return Number(match[1]) * 60 + Number(match[2]);
}

/** Tanggal dan menit lokal pada timezone kantor. */
export function localClock(now: Date, timeZone: string): Clock {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(now);
  const value = (type: string) => parts.find((part) => part.type === type)?.value ?? "00";
  const hour = Number(value("hour")) % 24;
  return {
    dateKey: `${value("year")}-${value("month")}-${value("day")}`,
    minutes: hour * 60 + Number(value("minute")),
  };
}

function addDays(dateKey: string, days: number): string {
  const date = new Date(`${dateKey}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/**
 * Reminder check-in H-30, peringatan terlambat pada jam masuk + toleransi, dan
 * check-out pada jam pulang. Untuk shift overnight, check-out pagi memakai
 * tanggal kerja hari sebelumnya agar pairing sesi tetap benar. Slot yang jatuh
 * sebelum tengah malam (mis. check-in 00:15 → reminder 23:45) juga didukung.
 */
export function dueReminders(input: {
  workStart: string;
  workEnd: string;
  timezone: string;
  now: Date;
  toleranceMinutes?: number;
  windowMinutes?: number;
}): Array<{ type: ReminderType; dateKey: string }> {
  const start = clockMinutes(input.workStart);
  const end = clockMinutes(input.workEnd);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return [];

  const clock = localClock(input.now, input.timezone);
  const window = input.windowMinutes ?? REMINDER_WINDOW_MINUTES;
  const tolerance = input.toleranceMinutes ?? DEFAULT_LATE_TOLERANCE_MINUTES;
  const overnight = end < start;
  const rawSlots: Array<{ type: ReminderType; minute: number }> = [
    { type: "CHECK_IN", minute: start - CHECK_IN_LEAD_MINUTES },
    { type: "LATE", minute: start + tolerance },
    { type: "CHECK_OUT", minute: overnight ? end + 24 * 60 : end },
  ];
  const slots = rawSlots.map((slot) => ({
    type: slot.type,
    dayDelta: Math.floor(slot.minute / (24 * 60)),
    minute: ((slot.minute % (24 * 60)) + 24 * 60) % (24 * 60),
  }));

  return slots
    .filter(
      (slot) =>
        clock.minutes >= slot.minute &&
        clock.minutes < slot.minute + window,
    )
    .map((slot) => ({
      type: slot.type,
      dateKey: addDays(clock.dateKey, -slot.dayDelta),
    }));
}

export type TickDeps = {
  retryAuditOutbox: () => Promise<unknown>;
  listWorkspaces: () => Promise<SchedulableWorkspace[]>;
  sendReminders: (input: {
    workspaceId: string;
    type: ReminderType;
    date: Date;
    shiftId?: string;
    unassignedOnly?: boolean;
  }) => Promise<unknown>;
  purgeTokens: () => Promise<{ deleted: number }>;
};

export type TickResult = {
  workspaces: number;
  reminders: number;
  failed: number;
  purgedTokens: number;
};

/**
 * Satu siklus worker. `sentKeys` mencegah reminder yang sama terkirim berulang
 * selama jendela 5 menit; key yang gagal dihapus agar dicoba pada tick berikut.
 */
export async function runScheduledTick(input: {
  now: Date;
  deps: TickDeps;
  sentKeys: Set<string>;
  purgeTokens?: boolean;
}): Promise<TickResult> {
  await input.deps.retryAuditOutbox();
  const workspaces = await input.deps.listWorkspaces();
  const result: TickResult = {
    workspaces: workspaces.length,
    reminders: 0,
    failed: 0,
    purgedTokens: 0,
  };

  for (const workspace of workspaces) {
    // Shift aktif menggantikan jam kantor; workspace tanpa shift memakai
    // fallback jam kantor. Satu workspace dapat memiliki beberapa shift.
    const hasShifts = (workspace.shifts?.length ?? 0) > 0;
    const schedules = [
      ...(workspace.shifts ?? []).map((shift) => ({
        key: `shift:${shift.id}`,
        shiftId: shift.id as string | undefined,
        workStart: shift.workStart,
        workEnd: shift.workEnd,
        timezone: shift.timezone,
        toleranceMinutes: shift.lateToleranceMinutes as number | undefined,
        unassignedOnly: false,
      })),
      ...(workspace.office
        ? [
            {
              key: "office",
              shiftId: undefined,
              workStart: workspace.office.workStart,
              workEnd: workspace.office.workEnd,
              timezone: workspace.office.timezone,
              toleranceMinutes: undefined,
              // Bila ada shift, jam kantor hanya untuk member tanpa shift.
              unassignedOnly: hasShifts,
            },
          ]
        : []),
    ];

    for (const schedule of schedules) {
      const due = dueReminders({
        workStart: schedule.workStart,
        workEnd: schedule.workEnd,
        timezone: schedule.timezone,
        now: input.now,
        ...(schedule.toleranceMinutes === undefined
          ? {}
          : { toleranceMinutes: schedule.toleranceMinutes }),
      });
      for (const slot of due) {
        const key = `${slot.dateKey}:${workspace.id}:${schedule.key}:${slot.type}`;
        if (input.sentKeys.has(key)) continue;
        input.sentKeys.add(key);
        try {
          await input.deps.sendReminders({
            workspaceId: workspace.id,
            type: slot.type,
            date: new Date(`${slot.dateKey}T00:00:00.000Z`),
            ...(schedule.shiftId ? { shiftId: schedule.shiftId } : {}),
            ...(schedule.unassignedOnly ? { unassignedOnly: true } : {}),
          });
          result.reminders += 1;
        } catch {
          input.sentKeys.delete(key);
          result.failed += 1;
        }
      }
    }
  }

  if (input.purgeTokens) {
    const purged = await input.deps.purgeTokens();
    result.purgedTokens = purged.deleted;
  }
  return result;
}
