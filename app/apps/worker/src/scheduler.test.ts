import assert from "node:assert/strict";
import test from "node:test";

import {
  dueReminders,
  localClock,
  runScheduledTick,
  type TickDeps,
} from "./scheduler.js";

const JAKARTA = "Asia/Jakarta";

test("W1: clock lokal dan slot reminder mengikuti timezone kantor", () => {
  const clock = localClock(new Date("2026-11-20T01:30:00.000Z"), JAKARTA);
  assert.equal(clock.dateKey, "2026-11-20");
  assert.equal(clock.minutes, 8 * 60 + 30);

  assert.deepEqual(
    dueReminders({
      workStart: "09:00",
      workEnd: "17:00",
      timezone: JAKARTA,
      now: new Date("2026-11-20T01:30:00.000Z"),
    }),
    [{ type: "CHECK_IN", dateKey: "2026-11-20" }],
  );

  assert.deepEqual(
    dueReminders({
      workStart: "09:00",
      workEnd: "17:00",
      timezone: JAKARTA,
      now: new Date("2026-11-20T02:15:00.000Z"),
    }),
    [{ type: "LATE", dateKey: "2026-11-20" }],
  );

  assert.deepEqual(
    dueReminders({
      workStart: "09:00",
      workEnd: "17:00",
      timezone: JAKARTA,
      now: new Date("2026-11-20T10:00:00.000Z"),
    }),
    [{ type: "CHECK_OUT", dateKey: "2026-11-20" }],
  );

  assert.deepEqual(
    dueReminders({
      workStart: "09:00",
      workEnd: "17:00",
      timezone: JAKARTA,
      now: new Date("2026-11-20T05:00:00.000Z"),
    }),
    [],
  );
});

test("W2: shift overnight memakai tanggal kerja H untuk check-out pagi H+1", () => {
  assert.deepEqual(
    dueReminders({
      workStart: "22:00",
      workEnd: "06:00",
      timezone: JAKARTA,
      now: new Date("2026-11-20T23:00:00.000Z"),
    }),
    [{ type: "CHECK_OUT", dateKey: "2026-11-20" }],
  );
  assert.deepEqual(
    dueReminders({
      workStart: "00:15",
      workEnd: "08:00",
      timezone: "UTC",
      now: new Date("2026-11-19T23:45:00.000Z"),
    }),
    [{ type: "CHECK_IN", dateKey: "2026-11-20" }],
  );
  assert.deepEqual(
    dueReminders({
      workStart: "00:15",
      workEnd: "08:00",
      timezone: "UTC",
      now: new Date("2026-11-20T00:00:00.000Z"),
    }),
    [],
  );
});

test("W3: satu tick menjalankan tiga job, dedupe, dan purge", async () => {
  const sent: Array<{ workspaceId: string; type: string }> = [];
  let retried = 0;
  let purged = 0;
  const deps: TickDeps = {
    retryAuditOutbox: async () => {
      retried += 1;
    },
    listWorkspaces: async () => [
      {
        id: "ws-a",
        office: { workStart: "09:00", workEnd: "17:00", timezone: JAKARTA },
      },
      { id: "ws-b", office: null },
      {
        id: "ws-c",
        office: { workStart: "09:00", workEnd: "17:00", timezone: "UTC" },
      },
    ],
    sendReminders: async ({ workspaceId, type }) => {
      sent.push({ workspaceId, type });
    },
    purgeTokens: async () => {
      purged += 1;
      return { deleted: 2 };
    },
  };
  const sentKeys = new Set<string>();
  const now = new Date("2026-11-20T01:30:00.000Z");

  const first = await runScheduledTick({ now, deps, sentKeys, purgeTokens: true });
  assert.deepEqual(first, {
    workspaces: 3,
    reminders: 1,
    failed: 0,
    purgedTokens: 2,
  });
  assert.deepEqual(sent, [{ workspaceId: "ws-a", type: "CHECK_IN" }]);
  assert.equal(retried, 1);
  assert.equal(purged, 1);

  const second = await runScheduledTick({ now, deps, sentKeys });
  assert.equal(second.reminders, 0);
  assert.equal(sent.length, 1);
});

test("W4: kegagalan kirim tidak memblokir workspace lain dan dicoba lagi", async () => {
  let attempts = 0;
  const deps: TickDeps = {
    retryAuditOutbox: async () => undefined,
    listWorkspaces: async () => [
      {
        id: "ws-a",
        office: { workStart: "09:00", workEnd: "17:00", timezone: JAKARTA },
      },
    ],
    sendReminders: async () => {
      attempts += 1;
      if (attempts === 1) throw new Error("push gagal");
    },
    purgeTokens: async () => ({ deleted: 0 }),
  };
  const sentKeys = new Set<string>();
  const now = new Date("2026-11-20T01:30:00.000Z");

  const first = await runScheduledTick({ now, deps, sentKeys });
  assert.equal(first.failed, 1);
  assert.equal(sentKeys.size, 0);

  const second = await runScheduledTick({ now, deps, sentKeys });
  assert.equal(second.reminders, 1);
  assert.equal(attempts, 2);
});
