import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomInt, randomUUID } from "node:crypto";
import { join } from "node:path";
import test, { after, before } from "node:test";

import { createTenantContext } from "../../../packages/database/dist/index.js";
import {
  adminClient,
  resetDatabase,
  seedMember,
  seedTenant,
} from "../../../packages/auth/dist/test-support.js";
import {
  registerPushToken,
  sendPushNotificationToUser,
  setPushNotificationSender,
} from "../../../packages/auth/dist/index.js";
import { reviewWfh } from "../../../packages/auth/dist/wfh.js";

const root = new URL("../../../", import.meta.url).pathname;

let db;
let server;
let baseUrl;
let tenant;
let employee;

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

async function callPushToken(token, method, body) {
  const response = await fetch(`${baseUrl}/api/mobile/push-token`, {
    method,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      "content-type": "application/json",
      connection: "close",
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { response, body: await response.json().catch(() => ({})) };
}

function ctxFor({ tenantId, userId, memberId, permissions }) {
  return createTenantContext({
    tenantId,
    userId,
    memberId,
    roleKeys: ["WORKSPACE_OWNER"],
    permissions,
  });
}

before(async () => {
  db = adminClient();
  await resetDatabase(db);
  tenant = await seedTenant(db, { name: "Push Token HTTP" });
  employee = await seedMember(db, tenant.tenantId, tenant.roles.VIEWER);

  const port = 4800 + randomInt(300);
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
  setPushNotificationSender(null);
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

test("PT-HTTP-1: POST /api/mobile/push-token menyimpan token milik user", async () => {
  const token = "fcm-http-push-token-android";
  const result = await callPushToken(employee.token, "POST", {
    token,
    platform: "android",
  });
  assert.equal(result.response.status, 201);
  assert.equal(result.body.platform, "android");

  const rows = await db.devicePushToken.findMany({ where: { token } });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].userId, employee.userId);
  assert.equal(rows[0].platform, "android");
});

test("PT-HTTP-2: POST memindahkan kepemilikan token dan memvalidasi input", async () => {
  const token = "fcm-http-push-token-shared";
  const first = await callPushToken(employee.token, "POST", {
    token,
    platform: "ios",
  });
  assert.equal(first.response.status, 201);

  const second = await callPushToken(tenant.ownerToken, "POST", {
    token,
    platform: "android",
  });
  assert.equal(second.response.status, 201);

  const rows = await db.devicePushToken.findMany({ where: { token } });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].userId, tenant.ownerUserId);

  const invalidPlatform = await callPushToken(employee.token, "POST", {
    token: "fcm-http-push-token-valid",
    platform: "windows",
  });
  assert.equal(invalidPlatform.response.status, 400);
  assert.equal(invalidPlatform.body.error.code, "INVALID_PLATFORM");

  const anonymous = await callPushToken(null, "POST", {
    token: "fcm-http-push-token-anon",
    platform: "android",
  });
  assert.equal(anonymous.response.status, 401);
});

test("PT-HTTP-3: DELETE /api/mobile/push-token menghapus token saat logout", async () => {
  const token = "fcm-http-push-token-logout";
  await callPushToken(employee.token, "POST", { token, platform: "android" });
  assert.equal((await db.devicePushToken.findMany({ where: { token } })).length, 1);

  const deleted = await callPushToken(employee.token, "DELETE", { token });
  assert.equal(deleted.response.status, 200);
  assert.equal(deleted.body.deleted, 1);
  assert.equal((await db.devicePushToken.findMany({ where: { token } })).length, 0);
});

test("PT-APPROVAL-1: approve WFH mengirim push ke seluruh token user", async () => {
  const sent = [];
  setPushNotificationSender({
    async send(tokens, message) {
      sent.push({ tokens: [...tokens], message });
      return { delivered: tokens.length, failed: 0, invalidTokens: [] };
    },
  });

  const memberCtx = ctxFor({
    tenantId: tenant.tenantId,
    userId: employee.userId,
    memberId: employee.memberId,
    permissions: ["workspace.read"],
  });
  await registerPushToken({
    ctx: memberCtx,
    token: "fcm-approval-token-wfh",
    platform: "ios",
  });

  const wfhId = randomUUID();
  await db.wfhRequest.create({
    data: {
      id: wfhId,
      tenantId: tenant.tenantId,
      memberId: employee.memberId,
      date: new Date("2026-12-01T00:00:00.000Z"),
      reason: "Keperluan keluarga di luar kota",
    },
  });

  const ownerCtx = ctxFor({
    tenantId: tenant.tenantId,
    userId: tenant.ownerUserId,
    memberId: tenant.ownerMemberId,
    permissions: ["workspace.read", "correction.review"],
  });
  const summary = await reviewWfh({
    ctx: ownerCtx,
    wfhId,
    action: "APPROVE",
  });

  assert.equal(summary.status, "APPROVED");
  assert.equal(sent.length, 1);
  // Employee punya dua perangkat terdaftar; keduanya menerima push yang sama.
  assert.ok(sent[0].tokens.includes("fcm-approval-token-wfh"));
  assert.equal(sent[0].tokens.length, 2);
  assert.match(sent[0].message.title, /WFH 2026-12-01 disetujui/);
  assert.equal(sent[0].message.data.type, "wfh_result");
  assert.equal(sent[0].message.data.status, "APPROVED");
});

test("PT-APPROVAL-2: reject WFH mengirim push dan token mati dibersihkan", async () => {
  const sent = [];
  setPushNotificationSender({
    async send(tokens, message) {
      sent.push({ tokens: [...tokens], message });
      return { delivered: 0, failed: tokens.length, invalidTokens: [...tokens] };
    },
  });

  const wfhId = randomUUID();
  await db.wfhRequest.create({
    data: {
      id: wfhId,
      tenantId: tenant.tenantId,
      memberId: employee.memberId,
      date: new Date("2026-12-02T00:00:00.000Z"),
      reason: "Keperluan keluarga di luar kota",
    },
  });

  const ownerCtx = ctxFor({
    tenantId: tenant.tenantId,
    userId: tenant.ownerUserId,
    memberId: tenant.ownerMemberId,
    permissions: ["workspace.read", "correction.review"],
  });
  const summary = await reviewWfh({
    ctx: ownerCtx,
    wfhId,
    action: "REJECT",
    rejectionReason: "Beban kerja sedang tinggi",
  });

  assert.equal(summary.status, "REJECTED");
  assert.equal(sent.length, 1);
  assert.match(sent[0].message.title, /WFH 2026-12-02 ditolak/);
  // Token yang dilaporkan not-registered langsung dihapus dari database.
  assert.equal(
    (await db.devicePushToken.findMany({ where: { token: "fcm-approval-token-wfh" } })).length,
    0,
  );
});

test("PT-APPROVAL-3: user tanpa token push tidak menggagalkan approval", async () => {
  const result = await sendPushNotificationToUser(employee.userId, {
    title: "Tanpa perangkat",
    body: "Tidak ada token aktif",
  });
  assert.deepEqual(result, { delivered: 0, failed: 0, pruned: 0 });
});
