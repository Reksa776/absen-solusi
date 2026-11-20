import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomInt } from "node:crypto";
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
let tenantA;
let tenantB;
let employeeA;
let employeeB;

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

async function register(token, body) {
  const response = await fetch(`${baseUrl}/api/notifications/register-device`, {
    method: "POST",
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      "content-type": "application/json",
      connection: "close",
    },
    body: JSON.stringify(body),
  });
  return { response, body: await response.json().catch(() => ({})) };
}

before(async () => {
  db = adminClient();
  await resetDatabase(db);
  tenantA = await seedTenant(db, { name: "Push HTTP A" });
  tenantB = await seedTenant(db, { name: "Push HTTP B" });
  employeeA = await seedMember(db, tenantA.tenantId, tenantA.roles.VIEWER);
  employeeB = await seedMember(db, tenantB.tenantId, tenantB.roles.VIEWER);

  const port = 3400 + randomInt(400);
  baseUrl = `http://127.0.0.1:${port}`;
  server = spawn(join(root, "node_modules", ".bin", "next"), ["start", "-p", String(port)], {
    cwd: join(root, "apps", "web"),
    env: {
      ...process.env,
      NODE_ENV: "production",
      S1_RATE_LIMITER: "memory",
      PUSH_TRANSPORT: "memory",
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

test("P-HTTP-1: register device token 201 dan ter-scope tenant", async () => {
  const token = "fcm-http-device-token-a";
  const result = await register(employeeA.token, { token, platform: "android" });
  assert.equal(result.response.status, 201);
  assert.equal(result.body.platform, "ANDROID");

  const rows = await db.deviceToken.findMany({ where: { token } });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].tenantId, tenantA.tenantId);
  assert.equal(rows[0].memberId, employeeA.memberId);

  const unknownTenant = await db.deviceToken.findMany({
    where: { token, tenantId: tenantB.tenantId },
  });
  assert.equal(unknownTenant.length, 0);
});

test("P-HTTP-2: token sama pada tenant lain menjadi baris terpisah", async () => {
  const token = "fcm-http-device-token-a";
  const result = await register(employeeB.token, { token, platform: "ANDROID" });
  assert.equal(result.response.status, 201);
  const rows = await db.deviceToken.findMany({ where: { token } });
  assert.equal(rows.length, 2);
  assert.deepEqual(
    rows.map((row) => row.tenantId).sort(),
    [tenantA.tenantId, tenantB.tenantId].sort(),
  );
});

test("P-HTTP-3: validasi platform, token, dan autentikasi", async () => {
  const platform = await register(employeeA.token, {
    token: "fcm-http-device-token-valid",
    platform: "WINDOWS",
  });
  assert.equal(platform.response.status, 400);
  assert.equal(platform.body.error.code, "INVALID_PLATFORM");

  const short = await register(employeeA.token, { token: "pendek", platform: "ANDROID" });
  assert.equal(short.response.status, 400);
  assert.equal(short.body.error.code, "INVALID_DEVICE_TOKEN");

  const anonymous = await register(null, {
    token: "fcm-http-device-token-anon",
    platform: "ANDROID",
  });
  assert.equal(anonymous.response.status, 401);
});
