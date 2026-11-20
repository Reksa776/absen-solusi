import { pathToFileURL } from "node:url";

import { purgeStaleDeviceTokens, sendAttendanceRemindersForDate } from "@absensi/auth";
import { retryAuditOutbox, systemDb } from "@absensi/database";

import {
  DEFAULT_INTERVAL_MS,
  localClock,
  runScheduledTick,
  type TickDeps,
} from "./scheduler.js";

function positiveInt(name: string, fallback: number): number {
  const parsed = Number(process.env[name] ?? "");
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export type WorkerHandle = {
  stop: () => Promise<void>;
  runOnce: () => Promise<void>;
};

/**
 * Loop interval sederhana (tanpa cron dependency). Tick pertama langsung
 * dijalankan agar audit outbox dan reminder tidak menunggu satu interval.
 */
export function startWorker(): WorkerHandle {
  const intervalMs = positiveInt("WORKER_INTERVAL_MS", DEFAULT_INTERVAL_MS);
  const tokenTtlDays = positiveInt("DEVICE_TOKEN_TTL_DAYS", 60);
  const sentKeys = new Set<string>();
  let lastPurgeAt = 0;
  let lastDateKey = "";
  let inFlight: Promise<void> | null = null;
  let stopped = false;

  const deps: TickDeps = {
    retryAuditOutbox: () => retryAuditOutbox(),
    listWorkspaces: async () => {
      const rows = await systemDb().workspace.findMany({
        where: { status: "ACTIVE" },
        select: {
          id: true,
          officeLocations: {
            where: { isActive: true },
            orderBy: [{ createdAt: "asc" }, { id: "asc" }],
            take: 1,
            select: { workStart: true, workEnd: true, timezone: true },
          },
          workShifts: {
            where: { isActive: true },
            orderBy: [{ startTime: "asc" }, { id: "asc" }],
            select: {
              id: true,
              startTime: true,
              endTime: true,
              lateToleranceMinutes: true,
            },
          },
        },
      });
      return rows.map((row) => ({
        id: row.id,
        office: row.officeLocations[0] ?? null,
        shifts: row.workShifts.map((shift) => ({
          id: shift.id,
          workStart: shift.startTime,
          workEnd: shift.endTime,
          timezone: row.officeLocations[0]?.timezone ?? "UTC",
          lateToleranceMinutes: shift.lateToleranceMinutes,
        })),
      }));
    },
    sendReminders: ({ workspaceId, type, date, shiftId, unassignedOnly }) =>
      sendAttendanceRemindersForDate({
        workspaceId,
        type,
        date,
        shiftId,
        unassignedOnly,
      }),
    purgeTokens: () => purgeStaleDeviceTokens({ olderThanDays: tokenTtlDays }),
  };

  async function tick(): Promise<void> {
    if (stopped || inFlight) return;
    inFlight = (async () => {
      const now = new Date();
      const dateKey = localClock(now, "UTC").dateKey;
      if (lastDateKey !== dateKey) {
        sentKeys.clear();
        lastDateKey = dateKey;
      }
      const purge = now.getTime() - lastPurgeAt >= 86_400_000;
      try {
        const result = await runScheduledTick({ now, deps, sentKeys, purgeTokens: purge });
        if (purge) lastPurgeAt = now.getTime();
        console.log(
          JSON.stringify({
            level: "info",
            msg: "worker tick",
            at: now.toISOString(),
            ...result,
          }),
        );
      } catch (error) {
        console.error(
          JSON.stringify({
            level: "error",
            msg: "worker tick failed",
            at: now.toISOString(),
            error: error instanceof Error ? error.message : String(error),
          }),
        );
      }
    })();
    try {
      await inFlight;
    } finally {
      inFlight = null;
    }
  }

  const timer = setInterval(() => void tick(), intervalMs);

  const shutdown = async (): Promise<void> => {
    if (stopped) return;
    stopped = true;
    clearInterval(timer);
    if (inFlight) await inFlight.catch(() => undefined);
  };

  const onSignal = () => {
    void shutdown().finally(() => process.exit(0));
  };
  process.once("SIGTERM", onSignal);
  process.once("SIGINT", onSignal);

  void tick();

  return { stop: shutdown, runOnce: tick };
}

const entry = process.argv[1];
if (entry && import.meta.url === pathToFileURL(entry).href) {
  startWorker();
  console.log(
    JSON.stringify({
      level: "info",
      msg: "absensi worker started",
      intervalMs: positiveInt("WORKER_INTERVAL_MS", DEFAULT_INTERVAL_MS),
    }),
  );
}
