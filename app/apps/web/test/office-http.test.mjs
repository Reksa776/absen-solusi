import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomInt } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after, before } from "node:test";

import {
  adminClient,
  resetDatabase,
  seedMember,
  seedTenant,
} from "../../../packages/auth/dist/test-support.js";

const root = new URL("../../../", import.meta.url).pathname;
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 9, 8, 7, 0xff, 0xd9]);

let db;
let server;
let baseUrl;
let photoDir;
let tenantA;
let tenantB;
let adminA;
let employeeA;
let assignedEmployee;

const OFFICE_A = {
  name: "Kantor Pusat",
  address: "Jl. Sudirman No. 1",
  latitude: -6.2,
  longitude: 106.8,
  radiusMeters: 120,
  timezone: "Asia/Jakarta",
  workStart: "09:00",
  workEnd: "17:00",
  isActive: true,
};

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

async function send(path, token, method = "GET", body) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      connection: "close",
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { response, body: await response.json().catch(() => ({})) };
}

async function checkIn(token, office) {
  const form = new FormData();
  form.set("latitude", String(office.latitude));
  form.set("longitude", String(office.longitude));
  form.set("accuracy_meters", "5");
  form.set("is_mock_location", "false");
  form.set("device_info", "office-http");
  form.set("photo", new Blob([JPEG], { type: "image/jpeg" }), "selfie.jpg");
  const response = await fetch(`${baseUrl}/api/attendance/check-in`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, connection: "close" },
    body: form,
  });
  return { response, body: await response.json() };
}

before(async () => {
  db = adminClient();
  await resetDatabase(db);
  tenantA = await seedTenant(db, { name: "Office A" });
  tenantB = await seedTenant(db, { name: "Office B" });
  adminA = await seedMember(db, tenantA.tenantId, tenantA.roles.WORKSPACE_ADMIN);
  employeeA = await seedMember(db, tenantA.tenantId, tenantA.roles.VIEWER);
  assignedEmployee = await seedMember(db, tenantA.tenantId, tenantA.roles.VIEWER);
  photoDir = await mkdtemp(join(tmpdir(), "absensi-office-photo-"));

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

test("C-OFF-1: workspace baru belum punya kantor, check-in ditolak", async () => {
  const before = await checkIn(employeeA.token, OFFICE_A);
  assert.equal(before.response.status, 409);
  assert.equal(before.body.error.code, "OFFICE_NOT_CONFIGURED");

  const list = await send(`/api/workspaces/${tenantA.tenantId}/office`, adminA.token);
  assert.equal(list.response.status, 200);
  assert.deepEqual(list.body.offices, []);

  const denied = await send(`/api/workspaces/${tenantA.tenantId}/office`, employeeA.token);
  assert.equal(denied.response.status, 403);
});

test("C-OFF-2: admin dapat mengaktifkan beberapa kantor sekaligus", async () => {
  const created = await send(
    `/api/workspaces/${tenantA.tenantId}/office`,
    adminA.token,
    "POST",
    OFFICE_A,
  );
  assert.equal(created.response.status, 201);
  assert.equal(created.body.name, OFFICE_A.name);
  assert.equal(created.body.address, OFFICE_A.address);
  assert.equal(created.body.isActive, true);

  const audit = await db.auditLog.findFirstOrThrow({
    where: { action: "workspace.office_create", resourceId: created.body.id },
  });
  assert.equal(audit.tenantId, tenantA.tenantId);
  assert.deepEqual(audit.metadata, {
    name: OFFICE_A.name,
    isActive: true,
    hasGoogleMapsUrl: false,
  });

  const second = await send(
    `/api/workspaces/${tenantA.tenantId}/office`,
    adminA.token,
    "POST",
    { ...OFFICE_A, name: "Kantor Cabang", address: "Jl. Gatot Subroto 2" },
  );
  assert.equal(second.response.status, 201);

  const rows = await db.officeLocation.findMany({
    where: { tenantId: tenantA.tenantId },
    orderBy: { createdAt: "asc" },
  });
  assert.equal(rows.filter((row) => row.isActive).length, 2);
  assert.equal(rows.find((row) => row.id === created.body.id).isActive, true);
  assert.equal(rows.find((row) => row.id === second.body.id).isActive, true);

  const invalidTimezone = await send(
    `/api/workspaces/${tenantA.tenantId}/office`,
    adminA.token,
    "POST",
    { ...OFFICE_A, timezone: "Mars/Olympus" },
  );
  assert.equal(invalidTimezone.response.status, 400);
  assert.equal(invalidTimezone.body.error.code, "INVALID_TIMEZONE");

  const invalidRadius = await send(
    `/api/workspaces/${tenantA.tenantId}/office`,
    adminA.token,
    "POST",
    { ...OFFICE_A, radiusMeters: 5 },
  );
  assert.equal(invalidRadius.response.status, 400);
  assert.equal(invalidRadius.body.error.code, "INVALID_RADIUS");

  const updated = await send(
    `/api/workspaces/${tenantA.tenantId}/office/${created.body.id}`,
    adminA.token,
    "PATCH",
    { address: "Jl. Sudirman No. 10", radiusMeters: 150, isActive: true },
  );
  assert.equal(updated.response.status, 200);
  assert.equal(updated.body.address, "Jl. Sudirman No. 10");
  assert.equal(updated.body.radiusMeters, 150);
  assert.equal(updated.body.isActive, true);

  const active = await db.officeLocation.findMany({
    where: { tenantId: tenantA.tenantId, isActive: true },
    orderBy: { createdAt: "asc" },
  });
  assert.deepEqual(active.map((row) => row.id), [created.body.id, second.body.id]);

  const foreign = await send(
    `/api/workspaces/${tenantA.tenantId}/office/${second.body.id}`,
    tenantB.ownerToken,
    "PATCH",
    { isActive: true },
  );
  assert.equal(foreign.response.status, 403);

  const missing = await send(
    `/api/workspaces/${tenantA.tenantId}/office/00000000-0000-4000-8000-000000000000`,
    adminA.token,
    "PATCH",
    { isActive: true },
  );
  assert.equal(missing.response.status, 404);
  assert.equal(missing.body.error.code, "OFFICE_NOT_FOUND");
});

test("C-OFF-3: check-in langsung berfungsi memakai kantor yang dikonfigurasi UI/API", async () => {
  const inside = await checkIn(employeeA.token, { ...OFFICE_A, radiusMeters: 150 });
  assert.equal(inside.response.status, 201);
  assert.equal(inside.body.type, "CHECK_IN");

  const outside = await checkIn(employeeA.token, {
    latitude: -6.3,
    longitude: 106.9,
  });
  assert.equal(outside.response.status, 403);
  assert.equal(outside.body.error.code, "GEOFENCE_VIOLATION");
});

test("C-OFF-4: member ter-assign hanya boleh absen di kantornya; yang lain bebas memilih kantor aktif", async () => {
  const branch = {
    ...OFFICE_A,
    name: "Cabang Bandung",
    latitude: -6.3,
    longitude: 106.9,
    radiusMeters: 80,
  };
  const created = await send(
    `/api/workspaces/${tenantA.tenantId}/office`,
    adminA.token,
    "POST",
    branch,
  );
  assert.equal(created.response.status, 201);

  const assigned = await send(
    `/api/workspaces/${tenantA.tenantId}/members/${assignedEmployee.memberId}/office`,
    adminA.token,
    "PATCH",
    { officeLocationId: created.body.id },
  );
  assert.equal(assigned.response.status, 200);
  assert.equal(assigned.body.officeLocationId, created.body.id);
  assert.equal(
    (await db.auditLog.findFirstOrThrow({
      where: { action: "member.office_assign", resourceId: assignedEmployee.memberId },
    })).tenantId,
    tenantA.tenantId,
  );

  const deniedAtHq = await checkIn(assignedEmployee.token, OFFICE_A);
  assert.equal(deniedAtHq.response.status, 403);
  assert.equal(deniedAtHq.body.error.code, "GEOFENCE_VIOLATION");

  const insideBranch = await checkIn(assignedEmployee.token, branch);
  assert.equal(insideBranch.response.status, 201);
  assert.equal(
    (await db.attendanceLog.findFirstOrThrow({ where: { id: insideBranch.body.id } }))
      .officeLocationId,
    created.body.id,
  );

  const unassigned = await seedMember(db, tenantA.tenantId, tenantA.roles.VIEWER);
  const nearest = await checkIn(unassigned.token, branch);
  assert.equal(nearest.response.status, 201);

  const foreignAssign = await send(
    `/api/workspaces/${tenantA.tenantId}/members/${assignedEmployee.memberId}/office`,
    tenantB.ownerToken,
    "PATCH",
    { officeLocationId: created.body.id },
  );
  assert.equal(foreignAssign.response.status, 403);
});
