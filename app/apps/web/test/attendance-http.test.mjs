import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash, randomInt } from "node:crypto";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after, before } from "node:test";

import { adminClient } from "../../../packages/auth/dist/test-support.js";
import { resetDatabase, seedMember, seedTenant } from "../../../packages/auth/dist/test-support.js";

const root = new URL("../../../", import.meta.url).pathname;
const OFFICE = { latitude: -6.2, longitude: 106.8, radiusMeters: 100 };
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 9, 8, 7, 0xff, 0xd9]);
let db;
let server;
let baseUrl;
let photoDir;
let tenantA;
let tenantB;
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

function form(fields) {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, String(value));
  data.set("photo", new Blob([JPEG], { type: "image/jpeg" }), "selfie.jpg");
  return data;
}

async function attendance(path, token, fields, extraHeaders = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, connection: "close", ...extraHeaders },
    body: form(fields),
  });
  return { response, body: await response.json() };
}

async function get(path, token) {
  const response = await fetch(`${baseUrl}${path}`, {
    headers: { authorization: `Bearer ${token}`, connection: "close" },
  });
  return { response, body: await response.json() };
}

before(async () => {
  db = adminClient();
  await resetDatabase(db);
  photoDir = await mkdtemp(join(tmpdir(), "absensi-http-photo-"));
  tenantA = await seedTenant(db, { name: "HTTP A" });
  tenantB = await seedTenant(db, { name: "HTTP B" });
  employee = await seedMember(db, tenantA.tenantId, tenantA.roles.EMPLOYEE);
  for (const [tenantId, name] of [
    [tenantA.tenantId, "HTTP A HQ"],
    [tenantB.tenantId, "HTTP B HQ"],
  ]) {
    await db.officeLocation.create({
      data: {
        id: crypto.randomUUID(),
        tenantId,
        name,
        ...OFFICE,
        timezone: "Asia/Jakarta",
        workStart: "09:00",
        workEnd: "17:00",
      },
    });
  }

  // Hindari 3307 (port MariaDB dev) dan rentang ephemeral umum.
  const port = 4400 + randomInt(400);
  baseUrl = `http://127.0.0.1:${port}`;
  server = spawn(join(root, "node_modules", ".bin", "next"), ["start", "-p", String(port)], {
    cwd: join(root, "apps", "web"),
    env: {
      ...process.env,
      NODE_ENV: "production",
      S1_RATE_LIMITER: "memory",
      ATTENDANCE_PHOTO_DIR: photoDir,
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
  if (photoDir) await rm(photoDir, { recursive: true, force: true });
});

test("HTTP: check-in/out, status error, riwayat, audit, dan foto nyata", { timeout: 90_000 }, async () => {
  const office = await get("/api/attendance/office", tenantA.ownerToken);
  assert.equal(office.response.status, 200);
  assert.equal(office.body.office.id.length > 0, true);
  assert.equal(office.body.office.latitude, OFFICE.latitude);
  assert.equal(office.body.office.radiusMeters, OFFICE.radiusMeters);

  const inside = {
    latitude: OFFICE.latitude,
    longitude: OFFICE.longitude,
    accuracy_meters: 5,
    is_mock_location: false,
    device_info: "http-test",
  };

  const created = await attendance("/api/attendance/check-in", tenantA.ownerToken, inside);
  assert.equal(created.response.status, 201);
  assert.equal(created.body.type, "CHECK_IN");
  assert.equal(created.body.isSuspicious, false);

  const rows = await db.attendanceLog.findMany({ where: { tenantId: tenantA.tenantId } });
  assert.equal(rows.length, 1);
  const row = rows[0];
  assert.equal(row.photoHash, createHash("sha256").update(JPEG).digest("hex"));
  assert.equal(row.photoUrl, `/api/attendance/${created.body.id}/photo`);
  assert.equal("photo" in row, false);
  const files = await readdir(photoDir);
  assert.equal(files.length, 1);
  assert.equal(files[0], created.body.id);
  assert.deepEqual(new Uint8Array(await readFile(join(photoDir, files[0]))), JPEG);

  const audit = await db.auditLog.findFirst({
    where: { action: "attendance.check_in", resourceId: created.body.id },
  });
  assert.ok(audit);
  assert.equal(audit.tenantId, tenantA.tenantId);
  assert.equal(audit.actorUserId, tenantA.ownerUserId);
  assert.equal(audit.actorMemberId, tenantA.ownerMemberId);
  assert.equal(audit.ipHash?.length, 32);
  assert.deepEqual(Object.keys(audit.metadata).sort(), [
    "accuracy_meters",
    "attendance_status",
    "distance_meters",
    "early_leave_minutes",
    "late_minutes",
    "office_id",
    "offline_synced",
    "suspicious_reasons",
    "wfh_request_id",
    "work_mode",
    "work_pattern_id",
  ]);
  assert.equal(audit.metadata.offline_synced, false);
  const metadata = JSON.stringify(audit.metadata);
  assert.equal(metadata.includes(String(OFFICE.latitude)), false);
  assert.equal(metadata.includes(String(OFFICE.longitude)), false);
  assert.equal(metadata.includes(row.photoHash), false);

  const secondSession = await attendance("/api/attendance/check-in", tenantA.ownerToken, inside);
  assert.equal(secondSession.response.status, 201);
  assert.notEqual(secondSession.body.id, created.body.id);

  const checkout = await attendance("/api/attendance/check-out", tenantA.ownerToken, {
    ...inside,
    accuracy_meters: 8,
  });
  assert.equal(checkout.response.status, 200);
  const checkoutAudit = await db.auditLog.findFirst({
    where: { action: "attendance.check_out", resourceId: checkout.body.id },
  });
  assert.ok(checkoutAudit);

  const outside = await attendance("/api/attendance/check-in", tenantB.ownerToken, {
    ...inside,
    latitude: -6.3,
    longitude: 106.9,
  });
  assert.equal(outside.response.status, 403);
  assert.equal(outside.body.error.code, "GEOFENCE_VIOLATION");

  const badAccuracy = await attendance("/api/attendance/check-in", tenantB.ownerToken, {
    ...inside,
    accuracy_meters: 101,
  });
  assert.equal(badAccuracy.response.status, 400);
  assert.equal(badAccuracy.body.error.code, "ACCURACY_TOO_LOW");

  const mocked = await attendance("/api/attendance/check-in", tenantB.ownerToken, {
    ...inside,
    is_mock_location: true,
  });
  assert.equal(mocked.response.status, 403);
  assert.equal(mocked.body.error.code, "MOCK_LOCATION_DETECTED");

  assert.equal(await db.attendanceLog.count({ where: { tenantId: tenantB.tenantId } }), 0);

  const mine = await get("/api/attendance/me", tenantA.ownerToken);
  assert.equal(mine.response.status, 200);
  assert.deepEqual(mine.body.attendance.map((entry) => entry.id).sort(), [
    created.body.id,
    secondSession.body.id,
    checkout.body.id,
  ].sort());
  assert.equal(mine.body.attendance.every((entry) => entry.tenantId === tenantA.tenantId), true);

  const foreign = await get(`/api/workspaces/${tenantB.tenantId}/attendance`, tenantA.ownerToken);
  const missing = await get(
    "/api/workspaces/00000000-0000-4000-8000-000000000000/attendance",
    tenantA.ownerToken,
  );
  assert.equal(foreign.response.status, 403);
  assert.deepEqual(foreign.body, missing.body);

  const ownAdmin = await get(`/api/workspaces/${tenantA.tenantId}/attendance`, tenantA.ownerToken);
  assert.equal(ownAdmin.response.status, 200);
  assert.equal(ownAdmin.body.attendance.length, 3);

  const photoResponse = await fetch(`${baseUrl}${row.photoUrl}`, {
    headers: { authorization: `Bearer ${tenantA.ownerToken}`, connection: "close" },
  });
  assert.equal(photoResponse.status, 200);
  assert.equal(photoResponse.headers.get("content-type"), "image/jpeg");
  assert.match(photoResponse.headers.get("cache-control") ?? "", /no-store/);
  assert.deepEqual(new Uint8Array(await photoResponse.arrayBuffer()), JPEG);

  const foreignPhoto = await fetch(`${baseUrl}${row.photoUrl}`, {
    headers: { authorization: `Bearer ${tenantB.ownerToken}`, connection: "close" },
  });
  assert.equal(foreignPhoto.status, 403);

  const anonymousPhoto = await fetch(`${baseUrl}${row.photoUrl}`, {
    headers: { connection: "close" },
  });
  assert.equal(anonymousPhoto.status, 401);

  const missingPhoto = await get(
    "/api/attendance/00000000-0000-4000-8000-000000000000/photo",
    tenantA.ownerToken,
  );
  assert.equal(missingPhoto.response.status, 404);
});

test("HTTP-2: Idempotency-Key mengembalikan log yang sama dan audit offline_synced", async () => {
  const fields = {
    latitude: OFFICE.latitude,
    longitude: OFFICE.longitude,
    accuracy_meters: 5,
    is_mock_location: false,
    device_info: "offline-queue",
  };
  const key = "offline-550e8400-e29b-41d4-a716-446655440000";
  const first = await attendance("/api/attendance/check-in", employee.token, fields, {
    "idempotency-key": key,
  });
  assert.equal(first.response.status, 201);
  const replay = await attendance("/api/attendance/check-in", employee.token, fields, {
    "idempotency-key": key,
  });
  assert.equal(replay.response.status, 201);
  assert.equal(replay.body.id, first.body.id);
  assert.equal(
    await db.attendanceLog.count({
      where: { tenantId: tenantA.tenantId, memberId: employee.memberId, type: "CHECK_IN" },
    }),
    1,
  );
  const audits = await db.auditLog.findMany({
    where: { action: "attendance.check_in", resourceId: first.body.id },
  });
  assert.equal(audits.length, 1);
  assert.equal(audits[0].metadata.offline_synced, true);

  const different = await attendance("/api/attendance/check-in", employee.token, fields, {
    "idempotency-key": "offline-other-key-0001",
  });
  assert.equal(different.response.status, 201);
  assert.notEqual(different.body.id, first.body.id);

  const invalid = await attendance("/api/attendance/check-out", employee.token, fields, {
    "idempotency-key": "bad key!",
  });
  assert.equal(invalid.response.status, 400);
  assert.equal(invalid.body.error.code, "INVALID_IDEMPOTENCY_KEY");
});
