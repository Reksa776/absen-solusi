import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import test, { after, before } from "node:test";

import { createTenantContext, withTenant } from "@absensi/database";

import {
  registerDeviceToken,
  sendAttendanceRemindersForDate,
} from "./notifications.js";
import {
  FcmPushTransport,
  MemoryPushTransport,
  resolvePushTransport,
} from "./push.js";
import { adminClient, resetDatabase, seedTenant } from "./test-support.js";

let db: ReturnType<typeof adminClient>;

before(async () => {
  db = adminClient();
  await resetDatabase(db);
});

after(async () => {
  if (db) await db.$disconnect();
});

test("P1: memory push transport mencatat token dan menghitung kegagalan", async () => {
  const transport = new MemoryPushTransport({ failingTokens: ["bad-token"] });
  const result = await transport.send(["token-a", "bad-token"], {
    title: "Revisi disetujui",
    body: "Data diperbarui",
    data: { type: "correction_result" },
  });
  assert.deepEqual(result, { delivered: 1, failed: 1 });
  assert.equal(transport.sent.length, 1);
  assert.equal(transport.sent[0]?.token, "token-a");
  assert.equal(transport.sent[0]?.message.title, "Revisi disetujui");
});

test("P2: FCM HTTP v1 menerima payload per token tanpa membocorkan token ke log", async () => {
  const requests: Array<{ auth: string | undefined; body: string }> = [];
  const server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      requests.push({
        auth: request.headers.authorization,
        body: Buffer.concat(chunks).toString(),
      });
      response.writeHead(200, { "content-type": "application/json" });
      response.end("{}");
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  const transport = new FcmPushTransport({
    projectId: "proyek-uji",
    accessToken: "access-token-uji",
    fetchImpl: ((input: string | URL, init?: RequestInit) =>
      fetch(
        new URL(input.toString().replace("https://fcm.googleapis.com", `http://127.0.0.1:${port}`)),
        init,
      )) as typeof fetch,
  });
  try {
    const result = await transport.send(["device-token-abc"], {
      title: "Waktunya check-in",
      body: "Jangan lupa check-in",
      data: { type: "reminder_check_in" },
    });
    assert.deepEqual(result, { delivered: 1, failed: 0 });
  } finally {
    server.close();
  }
  assert.equal(requests.length, 1);
  assert.equal(requests[0]?.auth, "Bearer access-token-uji");
  assert.match(requests[0]?.body ?? "", /"token":"device-token-abc"/);
  assert.match(requests[0]?.body ?? "", /"title":"Waktunya check-in"/);
  assert.match(requests[0]?.body ?? "", /"reminder_check_in"/);
});

test("P3: konfigurasi push fail-closed di production", () => {
  assert.equal(resolvePushTransport({ NODE_ENV: "production" }).kind, "unavailable");
  assert.equal(
    resolvePushTransport({ NODE_ENV: "production", PUSH_TRANSPORT: "fcm" }).kind,
    "unavailable",
  );
  assert.equal(
    resolvePushTransport({
      NODE_ENV: "production",
      PUSH_TRANSPORT: "fcm",
      FCM_PROJECT_ID: "p",
      FCM_ACCESS_TOKEN: "t",
    }).kind,
    "transport",
  );
  assert.equal(resolvePushTransport({ NODE_ENV: "development" }).kind, "transport");
});

test("P4: device token tersimpan per tenant dan validasi platform", async () => {
  const tenantA = await seedTenant(db, { name: "Push A" });
  const tenantB = await seedTenant(db, { name: "Push B" });
  const ctxA = createTenantContext({
    tenantId: tenantA.tenantId,
    userId: tenantA.ownerUserId,
    memberId: tenantA.ownerMemberId,
    roleKeys: ["WORKSPACE_OWNER"],
    permissions: ["workspace.read"],
  });
  const ctxB = createTenantContext({
    tenantId: tenantB.tenantId,
    userId: tenantB.ownerUserId,
    memberId: tenantB.ownerMemberId,
    roleKeys: ["WORKSPACE_OWNER"],
    permissions: ["workspace.read"],
  });

  const token = "fcm-device-token-shared";
  const registeredA = await registerDeviceToken({ ctx: ctxA, token, platform: "android" });
  assert.equal(registeredA.platform, "ANDROID");

  const rowsA = await withTenant(ctxA, (db) => db.deviceToken.findMany());
  assert.equal(rowsA.length, 1);
  assert.equal(rowsA[0]?.tenantId, tenantA.tenantId);
  assert.equal(rowsA[0]?.memberId, tenantA.ownerMemberId);

  const registeredB = await registerDeviceToken({ ctx: ctxB, token, platform: "ANDROID" });
  assert.notEqual(registeredB.id, registeredA.id);
  const rowsB = await withTenant(ctxB, (db) => db.deviceToken.findMany());
  assert.equal(rowsB.length, 1);
  assert.equal(rowsB[0]?.tenantId, tenantB.tenantId);

  await assert.rejects(
    () => registerDeviceToken({ ctx: ctxA, token, platform: "WINDOWS" }),
    /Platform harus/,
  );
  await assert.rejects(
    () => registerDeviceToken({ ctx: ctxA, token: "pendek", platform: "ANDROID" }),
    /Token perangkat/,
  );
});

test("P5: reminder check-in hanya untuk member tanpa absensi pada tanggal itu", async () => {
  const tenant = await seedTenant(db, { name: "Reminder A" });
  const ctx = createTenantContext({
    tenantId: tenant.tenantId,
    userId: tenant.ownerUserId,
    memberId: tenant.ownerMemberId,
    roleKeys: ["WORKSPACE_OWNER"],
    permissions: ["workspace.read"],
  });
  await registerDeviceToken({ ctx, token: "reminder-device-token", platform: "ANDROID" });

  const transport = new MemoryPushTransport();
  const date = new Date("2026-11-23T00:00:00Z");
  const first = await sendAttendanceRemindersForDate({ date, type: "CHECK_IN", transport });
  assert.ok(first.delivered >= 1);
  assert.ok(
    transport.sent.some(
      (row) =>
        row.token === "reminder-device-token" &&
        row.message.data?.type === "reminder_check_in",
    ),
  );

  await db.attendanceLog.create({
    data: {
      id: randomUUID(),
      tenantId: tenant.tenantId,
      memberId: tenant.ownerMemberId,
      workDate: date,
      type: "CHECK_IN",
      timestampServer: new Date("2026-11-23T01:00:00Z"),
      latitude: -6.2,
      longitude: 106.8,
      accuracyMeters: 5,
      distanceMeters: 0,
      isMockLocation: false,
      photoUrl: "",
      photoHash: "",
    },
  });
  transport.sent.length = 0;
  await sendAttendanceRemindersForDate({ date, type: "CHECK_IN", transport });
  // Tenant lain pada test ini tetap punya token; yang penting member ini dilewati.
  assert.equal(
    transport.sent.some((row) => row.token === "reminder-device-token"),
    false,
  );

  const checkout = await sendAttendanceRemindersForDate({
    date,
    type: "CHECK_OUT",
    transport,
  });
  assert.ok(checkout.delivered >= 1);
  assert.ok(transport.sent.some((row) => row.message.data?.type === "reminder_check_out"));
});
