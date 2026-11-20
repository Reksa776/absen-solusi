import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomInt, randomUUID } from "node:crypto";
import { join } from "node:path";
import test, { after, before } from "node:test";

import {
  adminClient,
  resetDatabase,
  seedMember,
  seedTenant,
} from "../../../packages/auth/dist/test-support.js";

const root = new URL("../../../", import.meta.url).pathname;

let db;
let server;
let baseUrl;
let tenant;
let employee;
let logId;

async function waitForReady() {
  const deadline = Date.now() + 40_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/api/health/ready`, {
        headers: { connection: "close" },
      });
      if (response.status === 200) return;
    } catch {
      // server belum listen
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("Next server tidak siap dalam 40 detik");
}

async function submit(body) {
  const response = await fetch(`${baseUrl}/api/corrections`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${employee.token}`,
      "content-type": "application/json",
      connection: "close",
    },
    body: JSON.stringify(body),
  });
  return { response, body: await response.json() };
}

function validBody(overrides = {}) {
  return {
    requestType: "CHECK_IN",
    requestedTimestamp: "2026-11-18T02:00:00.000Z",
    reason: "Lupa check-in karena jaringan kantor terputus",
    ...overrides,
  };
}

before(async () => {
  db = adminClient();
  await resetDatabase(db);
  tenant = await seedTenant(db, { name: "Correction Limit" });
  employee = await seedMember(db, tenant.tenantId, tenant.roles.EMPLOYEE);
  logId = randomUUID();
  await db.attendanceLog.create({
    data: {
      id: logId,
      tenantId: tenant.tenantId,
      memberId: employee.memberId,
      workDate: new Date("2026-11-18T00:00:00.000Z"),
      type: "CHECK_IN",
      timestampServer: new Date("2026-11-18T01:00:00.000Z"),
      latitude: -6.2,
      longitude: 106.8,
      accuracyMeters: 5,
      distanceMeters: 0,
      isMockLocation: false,
      photoUrl: "",
      photoHash: "",
    },
  });

  const port = 3400 + randomInt(400);
  baseUrl = `http://127.0.0.1:${port}`;
  server = spawn(join(root, "node_modules", ".bin", "next"), ["start", "-p", String(port)], {
    cwd: join(root, "apps", "web"),
    env: {
      ...process.env,
      NODE_ENV: "production",
      S1_RATE_LIMITER: "memory",
      REVISION_MONTHLY_LIMIT: "1",
    },
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
  });
  server.stdout.on("data", (chunk) => process.stderr.write(chunk));
  server.stderr.on("data", (chunk) => process.stderr.write(chunk));
  await waitForReady();
});

after(async () => {
  if (server?.pid) {
    try {
      process.kill(-server.pid, "SIGTERM");
    } catch {
      // sudah berhenti
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
    try {
      process.kill(-server.pid, "SIGKILL");
    } catch {
      // sudah berhenti
    }
    server.stdout?.destroy();
    server.stderr?.destroy();
  }
  if (db) await db.$disconnect();
});

test("C-LIM-1: log yang sudah ada wajib attendanceLogId, lalu default 1/bulan", async () => {
  const missingLog = await submit(validBody());
  assert.equal(missingLog.response.status, 400);
  assert.equal(missingLog.body.error.code, "ATTENDANCE_LOG_REQUIRED");
  assert.equal(
    await db.correctionRequest.count({ where: { memberId: employee.memberId } }),
    0,
  );

  const created = await submit(validBody({ attendanceLogId: logId }));
  assert.equal(created.response.status, 201);
  assert.equal(created.body.attendanceLogId, logId);

  const second = await submit(
    validBody({
      requestedTimestamp: "2026-11-17T02:00:00.000Z",
      reason: "Pengajuan revisi kedua pada bulan yang sama",
    }),
  );
  assert.equal(second.response.status, 429);
  assert.equal(second.body.error.code, "REVISION_LIMIT_EXCEEDED");
  assert.ok(second.response.headers.get("retry-after"));
});
