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
const OFFICE = { latitude: -6.2, longitude: 106.8, radiusMeters: 100 };
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 9, 8, 7, 0xff, 0xd9]);

let db;
let server;
let baseUrl;
let tenantA;
let tenantB;
let employeeOne;
let employeeTwo;
let employeeThree;

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

function identity(deviceId, name = "Samsung SM-A546E", platform = "ANDROID") {
  return {
    "x-device-id": deviceId,
    "x-device-name": name,
    "x-device-platform": platform,
  };
}

function form(fields = {}) {
  const data = new FormData();
  data.set("latitude", String(OFFICE.latitude));
  data.set("longitude", String(OFFICE.longitude));
  data.set("accuracy_meters", "5");
  data.set("is_mock_location", "false");
  data.set("device_info", "device-binding-test");
  for (const [key, value] of Object.entries(fields)) data.set(key, String(value));
  data.set("photo", new Blob([JPEG], { type: "image/jpeg" }), "selfie.jpg");
  return data;
}

async function attendance(path, token, device, fields = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      connection: "close",
      ...identity(device),
    },
    body: form(fields),
  });
  return { response, body: await response.json().catch(() => ({})) };
}

async function get(path, token, device) {
  const response = await fetch(`${baseUrl}${path}`, {
    headers: {
      authorization: `Bearer ${token}`,
      connection: "close",
      ...(device ? identity(device) : {}),
    },
  });
  return { response, body: await response.json().catch(() => ({})) };
}

async function post(path, token) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, connection: "close" },
  });
  return { response, body: await response.json().catch(() => ({})) };
}

before(async () => {
  db = adminClient();
  await resetDatabase(db);
  tenantA = await seedTenant(db, { name: "Device Tenant A" });
  tenantB = await seedTenant(db, { name: "Device Tenant B" });
  employeeOne = await seedMember(db, tenantA.tenantId, tenantA.roles.EMPLOYEE);
  employeeTwo = await seedMember(db, tenantA.tenantId, tenantA.roles.VIEWER);
  employeeThree = await seedMember(db, tenantA.tenantId, tenantA.roles.VIEWER);

  for (const [tenantId, name] of [
    [tenantA.tenantId, "Device A HQ"],
    [tenantB.tenantId, "Device B HQ"],
  ]) {
    await db.officeLocation.create({
      data: {
        id: randomUUID(),
        tenantId,
        name,
        ...OFFICE,
        timezone: "Asia/Jakarta",
        workStart: "09:00",
        workEnd: "17:00",
      },
    });
  }

  // Hindari rentang port yang dicadangkan Node/NPP (mis. 4045).
  const port = 4200 + randomInt(300);
  baseUrl = `http://127.0.0.1:${port}`;
  server = spawn(join(root, "node_modules", ".bin", "next"), ["start", "-p", String(port)], {
    cwd: join(root, "apps", "web"),
    env: {
      ...process.env,
      NODE_ENV: "production",
      S1_RATE_LIMITER: "memory",
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

test("DEV-1: perangkat pertama otomatis APPROVED dan bisa check-in", { timeout: 90_000 }, async () => {
  const device = "device-employee-one-a";
  const result = await attendance(
    "/api/attendance/check-in",
    employeeOne.token,
    device,
  );
  assert.equal(result.response.status, 201, JSON.stringify(result.body));

  const rows = await db.memberDevice.findMany({
    where: { tenantId: tenantA.tenantId, memberId: employeeOne.memberId },
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].status, "APPROVED");
  assert.equal(rows[0].platform, "ANDROID");
  assert.equal(rows[0].deviceName, "Samsung SM-A546E");
  assert.ok(rows[0].approvedAt instanceof Date);

  const mine = await get("/api/mobile/device", employeeOne.token, device);
  assert.equal(mine.response.status, 200);
  assert.equal(mine.body.device.status, "APPROVED");
});

test("DEV-2: perangkat kedua PENDING, check-in diblokir 403, lalu disetujui admin", { timeout: 90_000 }, async () => {
  const firstDevice = "device-employee-two-a";
  const secondDevice = "device-employee-two-b";

  const first = await attendance(
    "/api/attendance/check-in",
    employeeTwo.token,
    firstDevice,
  );
  assert.equal(first.response.status, 201, JSON.stringify(first.body));

  const blocked = await attendance(
    "/api/attendance/check-out",
    employeeTwo.token,
    secondDevice,
  );
  assert.equal(blocked.response.status, 403);
  assert.equal(blocked.body.error.code, "DEVICE_PENDING_APPROVAL");

  const pendingRow = await db.memberDevice.findFirst({
    where: {
      tenantId: tenantA.tenantId,
      memberId: employeeTwo.memberId,
      deviceId: secondDevice,
    },
  });
  assert.equal(pendingRow.status, "PENDING");
  assert.equal(pendingRow.approvedByMemberId, null);

  const mine = await get("/api/mobile/device", employeeTwo.token, secondDevice);
  assert.equal(mine.body.device.status, "PENDING");

  const pendingList = await get(
    `/api/workspaces/${tenantA.tenantId}/devices?status=PENDING&search=Member`,
    tenantA.ownerToken,
  );
  assert.equal(pendingList.response.status, 200);
  assert.ok(pendingList.body.devices.some((row) => row.id === pendingRow.id));

  const approved = await post(
    `/api/workspaces/${tenantA.tenantId}/devices/${pendingRow.id}/approve`,
    tenantA.ownerToken,
  );
  assert.equal(approved.response.status, 200, JSON.stringify(approved.body));
  assert.equal(approved.body.status, "APPROVED");
  assert.equal(approved.body.approvedByMemberId, tenantA.ownerMemberId);

  const checkout = await attendance(
    "/api/attendance/check-out",
    employeeTwo.token,
    secondDevice,
  );
  assert.equal(checkout.response.status, 200, JSON.stringify(checkout.body));
  assert.equal(checkout.body.type, "CHECK_OUT");

  const audit = await db.auditLog.findFirst({
    where: {
      tenantId: tenantA.tenantId,
      action: "device.approve",
      resourceId: pendingRow.id,
    },
  });
  assert.ok(audit);
});

test("DEV-3: perangkat pending ditolak menjadi REVOKED dan check-in 403", { timeout: 90_000 }, async () => {
  const firstDevice = "device-employee-three-a";
  const secondDevice = "device-employee-three-b";

  const first = await attendance(
    "/api/attendance/check-in",
    employeeThree.token,
    firstDevice,
  );
  assert.equal(first.response.status, 201, JSON.stringify(first.body));

  const blocked = await attendance(
    "/api/attendance/check-out",
    employeeThree.token,
    secondDevice,
  );
  assert.equal(blocked.response.status, 403);
  assert.equal(blocked.body.error.code, "DEVICE_PENDING_APPROVAL");

  const pendingRow = await db.memberDevice.findFirst({
    where: {
      tenantId: tenantA.tenantId,
      memberId: employeeThree.memberId,
      deviceId: secondDevice,
    },
  });

  const rejected = await post(
    `/api/workspaces/${tenantA.tenantId}/devices/${pendingRow.id}/reject`,
    tenantA.ownerToken,
  );
  assert.equal(rejected.response.status, 200, JSON.stringify(rejected.body));
  assert.equal(rejected.body.status, "REVOKED");
  assert.ok(rejected.body.revokedAt);

  const retry = await attendance(
    "/api/attendance/check-out",
    employeeThree.token,
    secondDevice,
  );
  assert.equal(retry.response.status, 403);
  assert.equal(retry.body.error.code, "DEVICE_REVOKED");

  const audit = await db.auditLog.findFirst({
    where: {
      tenantId: tenantA.tenantId,
      action: "device.reject",
      resourceId: pendingRow.id,
    },
  });
  assert.ok(audit);

  const notification = await db.inAppNotification.findFirst({
    where: {
      tenantId: tenantA.tenantId,
      memberId: employeeThree.memberId,
      type: "DEVICE_REJECTED",
    },
  });
  assert.ok(notification);
  assert.match(notification.title, /ditolak/);
});

test("DEV-4: reset karyawan mencabut semua perangkat aktif", { timeout: 90_000 }, async () => {
  const device = "device-employee-one-a";
  const reset = await post(
    `/api/workspaces/${tenantA.tenantId}/members/${employeeOne.memberId}/devices/reset`,
    tenantA.ownerToken,
  );
  assert.equal(reset.response.status, 200, JSON.stringify(reset.body));
  assert.equal(reset.body.resetCount, 1);

  const mine = await get("/api/mobile/device", employeeOne.token, device);
  assert.equal(mine.body.device.status, "REVOKED");

  const blocked = await attendance(
    "/api/attendance/check-in",
    employeeOne.token,
    device,
  );
  assert.equal(blocked.response.status, 403);
  assert.equal(blocked.body.error.code, "DEVICE_REVOKED");

  const audit = await db.auditLog.findFirst({
    where: {
      tenantId: tenantA.tenantId,
      action: "device.reset",
      resourceId: employeeOne.memberId,
    },
  });
  assert.ok(audit);
});

test("DEV-5: isolasi tenant dan RBAC daftar perangkat", { timeout: 90_000 }, async () => {
  const crossRead = await get(
    `/api/workspaces/${tenantA.tenantId}/devices`,
    tenantB.ownerToken,
  );
  assert.equal(crossRead.response.status, 403);

  const employeeRead = await get(
    `/api/workspaces/${tenantA.tenantId}/devices`,
    employeeOne.token,
  );
  assert.equal(employeeRead.response.status, 403);

  const ownList = await get(
    `/api/workspaces/${tenantB.tenantId}/devices`,
    tenantB.ownerToken,
  );
  assert.equal(ownList.response.status, 200);
  assert.deepEqual(ownList.body.devices, []);

  const pendingRow = await db.memberDevice.findFirst({
    where: {
      tenantId: tenantA.tenantId,
      memberId: employeeThree.memberId,
      deviceId: "device-employee-three-b",
    },
  });
  const crossApprove = await post(
    `/api/workspaces/${tenantA.tenantId}/devices/${pendingRow.id}/approve`,
    tenantB.ownerToken,
  );
  assert.equal(crossApprove.response.status, 403);
});
