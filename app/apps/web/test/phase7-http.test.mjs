import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomInt, randomUUID } from "node:crypto";
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
let employeeB;
let employeeC;
let employeeD;
let officeA;

const OFFICE = {
  name: "HQ",
  address: "Jakarta",
  latitude: -6.2,
  longitude: 106.8,
  radiusMeters: 100,
  timezone: "Asia/Jakarta",
  workStart: "08:00",
  workEnd: "17:00",
  isActive: true,
};

function dayKey(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

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

async function checkIn(token, latitude, longitude) {
  const form = new FormData();
  form.set("latitude", String(latitude));
  form.set("longitude", String(longitude));
  form.set("accuracy_meters", "5");
  form.set("is_mock_location", "false");
  form.set("device_info", "phase7-http");
  form.set("photo", new Blob([JPEG], { type: "image/jpeg" }), "selfie.jpg");
  const response = await fetch(`${baseUrl}/api/attendance/check-in`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, connection: "close" },
    body: form,
  });
  return { response, body: await response.json().catch(() => ({})) };
}

before(async () => {
  db = adminClient();
  await resetDatabase(db);
  tenantA = await seedTenant(db, { name: "Phase 7 A" });
  tenantB = await seedTenant(db, { name: "Phase 7 B" });
  adminA = await seedMember(db, tenantA.tenantId, tenantA.roles.WORKSPACE_ADMIN);
  employeeA = await seedMember(db, tenantA.tenantId, tenantA.roles.EMPLOYEE);
  employeeB = await seedMember(db, tenantA.tenantId, tenantA.roles.EMPLOYEE);
  employeeC = await seedMember(db, tenantA.tenantId, tenantA.roles.EMPLOYEE);
  employeeD = await seedMember(db, tenantA.tenantId, tenantA.roles.EMPLOYEE);
  photoDir = await mkdtemp(join(tmpdir(), "absensi-phase7-photo-"));

  const port = 3900 + randomInt(90);
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
    await new Promise((resolve) => setTimeout(resolve, 500));
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

test("7.1: banyak kantor aktif dan check-in memilih kantor terdekat", async () => {
  const created = await send(
    `/api/workspaces/${tenantA.tenantId}/office`,
    adminA.token,
    "POST",
    OFFICE,
  );
  assert.equal(created.response.status, 201);
  officeA = created.body;

  const branch = await send(
    `/api/workspaces/${tenantA.tenantId}/office`,
    adminA.token,
    "POST",
    { ...OFFICE, name: "Cabang", latitude: -6.3, longitude: 106.9 },
  );
  assert.equal(branch.response.status, 201);
  const offices = await send(`/api/workspaces/${tenantA.tenantId}/office`, adminA.token);
  assert.equal(offices.body.offices.filter((row) => row.isActive).length, 2);

  const checkInAtBranch = await checkIn(employeeB.token, -6.3, 106.9);
  assert.equal(checkInAtBranch.response.status, 201);
  const log = await db.attendanceLog.findFirstOrThrow({
    where: { id: checkInAtBranch.body.id },
  });
  assert.equal(log.officeLocationId, branch.body.id);
});

test("7.2: shift default menentukan keterlambatan dashboard", async () => {
  const shift = await send(
    `/api/workspaces/${tenantA.tenantId}/shifts`,
    adminA.token,
    "POST",
    { name: "Pagi", startTime: "09:00", endTime: "17:00", lateToleranceMinutes: 5 },
  );
  assert.equal(shift.response.status, 201);
  const assigned = await send(
    `/api/workspaces/${tenantA.tenantId}/shift-assignments`,
    adminA.token,
    "POST",
    { memberId: employeeA.memberId, shiftId: shift.body.id, workDate: null },
  );
  assert.equal(assigned.response.status, 201);

  const date = dayKey();
  await db.attendanceLog.create({
    data: {
      id: randomUUID(),
      tenantId: tenantA.tenantId,
      memberId: employeeA.memberId,
      workDate: new Date(`${date}T00:00:00.000Z`),
      type: "CHECK_IN",
      timestampServer: new Date(`${date}T02:30:00.000Z`),
      latitude: OFFICE.latitude,
      longitude: OFFICE.longitude,
      accuracyMeters: 5,
      distanceMeters: 0,
      officeLocationId: officeA.id,
      isMockLocation: false,
      photoUrl: "/test",
      photoHash: "a".repeat(64),
    },
  });
  const dashboard = await send(
    `/api/workspaces/${tenantA.tenantId}/dashboard/today?date=${date}`,
    adminA.token,
  );
  assert.equal(dashboard.response.status, 200);
  const row = dashboard.body.members.find((member) => member.memberId === employeeA.memberId);
  assert.equal(row.status, "ON_SITE");
  assert.equal(row.lateMinutes, 25);

  const crossTenant = await send(
    `/api/workspaces/${tenantA.tenantId}/shifts`,
    tenantB.ownerToken,
  );
  assert.equal(crossTenant.response.status, 403);
});

test("7.3: karyawan mengajukan lembur dan Admin/HR approve dengan audit", async () => {
  const submitted = await send("/api/overtime", employeeA.token, "POST", {
    date: dayKey(),
    startTime: "18:00",
    endTime: "20:30",
    reason: "Menyelesaikan laporan bulanan",
  });
  assert.equal(submitted.response.status, 201);
  assert.equal(submitted.body.durationMinutes, 150);
  assert.equal(submitted.body.status, "PENDING");

  const duplicate = await send("/api/overtime", employeeA.token, "POST", {
    date: dayKey(),
    startTime: "21:00",
    endTime: "22:00",
    reason: "Pengajuan kedua pada hari yang sama",
  });
  assert.equal(duplicate.response.status, 409);

  const mine = await send("/api/overtime/me", employeeA.token);
  assert.equal(mine.body.overtime.length, 1);

  const forbidden = await send(
    `/api/workspaces/${tenantA.tenantId}/overtime`,
    employeeA.token,
  );
  assert.equal(forbidden.response.status, 403);

  const approved = await send(
    `/api/overtime/${submitted.body.id}`,
    adminA.token,
    "PATCH",
    { action: "APPROVE" },
  );
  assert.equal(approved.response.status, 200);
  assert.equal(approved.body.status, "APPROVED");
  const audit = await db.auditLog.findFirstOrThrow({
    where: { action: "overtime.approve", resourceId: submitted.body.id },
  });
  assert.equal(audit.tenantId, tenantA.tenantId);

  const inbox = await send("/api/notifications/me", employeeA.token);
  assert.equal(inbox.response.status, 200);
  assert.equal(inbox.body.unreadCount, 1);
  const note = inbox.body.notifications.find((row) => row.type === "OVERTIME_APPROVED");
  assert.ok(note);
  const read = await send(`/api/notifications/${note.id}/read`, employeeA.token, "PATCH");
  assert.equal(read.response.status, 200);
  assert.equal(read.body.isRead, true);
  const foreignRead = await send(
    `/api/notifications/${note.id}/read`,
    tenantB.ownerToken,
    "PATCH",
  );
  assert.equal(foreignRead.response.status, 404);

  const foreign = await send(
    `/api/overtime/${submitted.body.id}`,
    tenantB.ownerToken,
    "PATCH",
    { action: "REJECT", rejectionReason: "Bukan tenant saya" },
  );
  assert.equal(foreign.response.status, 404);
});

test("7.6: payroll summary menghitung office/WFH, libur, alpha, telat, kerja, dan lembur approved", async () => {
  const shift = await send(
    `/api/workspaces/${tenantA.tenantId}/shifts`,
    adminA.token,
    "POST",
    { name: "Payroll Pagi", startTime: "09:00", endTime: "17:00", lateToleranceMinutes: 15 },
  );
  assert.equal(shift.response.status, 201);
  const assigned = await send(
    `/api/workspaces/${tenantA.tenantId}/shift-assignments`,
    adminA.token,
    "POST",
    { memberId: employeeD.memberId, shiftId: shift.body.id, workDate: null },
  );
  assert.equal(assigned.response.status, 201);

  const workDate = (value) => new Date(`${value}T00:00:00.000Z`);
  const log = (id, date, type, timestamp, workMode = "OFFICE") => ({
    id,
    tenantId: tenantA.tenantId,
    memberId: employeeD.memberId,
    workDate: workDate(date),
    type,
    timestampServer: new Date(timestamp),
    latitude: OFFICE.latitude,
    longitude: OFFICE.longitude,
    accuracyMeters: 5,
    distanceMeters: 0,
    officeLocationId: officeA.id,
    workMode,
    isMockLocation: false,
    photoUrl: "/test",
    photoHash: "c".repeat(64),
  });
  await db.attendanceLog.createMany({
    data: [
      log(randomUUID(), "2026-11-02", "CHECK_IN", "2026-11-02T02:20:00.000Z"),
      log(randomUUID(), "2026-11-02", "CHECK_OUT", "2026-11-02T10:20:00.000Z"),
      log(randomUUID(), "2026-11-03", "CHECK_IN", "2026-11-03T02:00:00.000Z", "WFH"),
      log(randomUUID(), "2026-11-03", "CHECK_OUT", "2026-11-03T10:00:00.000Z", "WFH"),
    ],
  });
  await db.workspaceHoliday.create({
    data: {
      id: randomUUID(),
      tenantId: tenantA.tenantId,
      date: workDate("2026-11-04"),
      name: "Libur payroll",
    },
  });
  await db.overtimeRequest.createMany({
    data: [
      {
        id: randomUUID(),
        tenantId: tenantA.tenantId,
        memberId: employeeD.memberId,
        date: workDate("2026-11-03"),
        startTime: "18:00",
        endTime: "19:30",
        durationMinutes: 90,
        reason: "Lembur payroll disetujui",
        status: "APPROVED",
      },
      {
        id: randomUUID(),
        tenantId: tenantA.tenantId,
        memberId: employeeD.memberId,
        date: workDate("2026-11-04"),
        startTime: "18:00",
        endTime: "19:00",
        durationMinutes: 60,
        reason: "Lembur payroll pending",
        status: "PENDING",
      },
    ],
  });

  const summary = await send(
    `/api/workspaces/${tenantA.tenantId}/reports/payroll-summary?from=2026-11-02&to=2026-11-08`,
    adminA.token,
  );
  assert.equal(summary.response.status, 200);
  const row = summary.body.members.find((member) => member.memberId === employeeD.memberId);
  assert.deepEqual(
    {
      presentDays: row.presentDays,
      officeDays: row.officeDays,
      wfhDays: row.wfhDays,
      holidayDays: row.holidayDays,
      weekendDays: row.weekendDays,
      absentDays: row.absentDays,
      lateIncidents: row.lateIncidents,
      lateMinutes: row.lateMinutes,
      workMinutes: row.workMinutes,
      workHours: row.workHours,
      overtimeMinutes: row.overtimeMinutes,
      overtimeHours: row.overtimeHours,
    },
    {
      presentDays: 2,
      officeDays: 1,
      wfhDays: 1,
      holidayDays: 1,
      weekendDays: 2,
      absentDays: 2,
      lateIncidents: 1,
      lateMinutes: 5,
      workMinutes: 960,
      workHours: 16,
      overtimeMinutes: 90,
      overtimeHours: 1.5,
    },
  );

  const csv = await fetch(
    `${baseUrl}/api/workspaces/${tenantA.tenantId}/reports/payroll-summary/export?from=2026-11-02&to=2026-11-08&format=csv`,
    { headers: { authorization: `Bearer ${adminA.token}`, connection: "close" } },
  );
  assert.equal(csv.status, 200);
  const text = await csv.text();
  assert.match(text, /member_name,present_days,office_days,wfh_days/);
  assert.match(text, /,2,1,1,1,2,2,1,5,960,16,90,1\.5/);
  const audit = await db.auditLog.findFirstOrThrow({
    where: { action: "report.export", resourceId: tenantA.tenantId },
  });
  assert.equal(audit.metadata.report, "payroll_summary");

  const forbidden = await send(
    `/api/workspaces/${tenantA.tenantId}/reports/payroll-summary?from=2026-11-02&to=2026-11-08`,
    employeeD.token,
  );
  assert.equal(forbidden.response.status, 403);
  const foreign = await send(
    `/api/workspaces/${tenantA.tenantId}/reports/payroll-summary?from=2026-11-02&to=2026-11-08`,
    tenantB.ownerToken,
  );
  assert.equal(foreign.response.status, 403);
});

test("7.4: WFH approved melewati geofence dan menandai work_mode", async () => {
  const submitted = await send("/api/wfh", employeeC.token, "POST", {
    date: dayKey(),
    reason: "Kabel kantor sedang diperbaiki",
  });
  assert.equal(submitted.response.status, 201);

  const outsideBefore = await checkIn(employeeC.token, -6.9, 107.6);
  assert.equal(outsideBefore.response.status, 403);
  assert.equal(outsideBefore.body.error.code, "GEOFENCE_VIOLATION");

  const approved = await send(`/api/wfh/${submitted.body.id}`, adminA.token, "PATCH", {
    action: "APPROVE",
  });
  assert.equal(approved.response.status, 200);

  const wfhCheckIn = await checkIn(employeeC.token, -6.9, 107.6);
  assert.equal(wfhCheckIn.response.status, 201);
  assert.equal(wfhCheckIn.body.workMode, "WFH");
  const log = await db.attendanceLog.findFirstOrThrow({ where: { id: wfhCheckIn.body.id } });
  assert.equal(log.workMode, "WFH");
  assert.equal(log.officeLocationId, null);

  const mine = await send("/api/wfh/me", employeeC.token);
  assert.equal(mine.body.wfh[0].status, "APPROVED");
  assert.equal(
    (await db.auditLog.findFirstOrThrow({
      where: { action: "wfh.approve", resourceId: submitted.body.id },
    })).tenantId,
    tenantA.tenantId,
  );

  const inbox = await send("/api/notifications/me", employeeC.token);
  assert.equal(inbox.body.unreadCount, 1);
  assert.equal(inbox.body.notifications[0].type, "WFH_APPROVED");
  const readAll = await send("/api/notifications/read-all", employeeC.token, "POST");
  assert.equal(readAll.response.status, 200);
  assert.equal(readAll.body.updated, 1);
  assert.equal((await send("/api/notifications/me", employeeC.token)).body.unreadCount, 0);
});

test("7.7: revisi yang di-approve membuat notifikasi milik member dan terisolasi per tenant", async () => {
  const existing = await db.attendanceLog.findFirstOrThrow({
    where: { tenantId: tenantA.tenantId, memberId: employeeB.memberId, type: "CHECK_IN" },
  });
  const correctionId = randomUUID();
  await db.correctionRequest.create({
    data: {
      id: correctionId,
      tenantId: tenantA.tenantId,
      memberId: employeeB.memberId,
      attendanceLogId: existing.id,
      requestType: "CHECK_IN",
      requestedTimestamp: new Date(existing.timestampServer.getTime() + 15 * 60_000),
      originalTimestamp: existing.timestampServer,
      reason: "Lupa menekan tombol pada jam masuk",
      status: "PENDING",
    },
  });
  const reviewed = await send(`/api/corrections/${correctionId}`, adminA.token, "PATCH", {
    action: "approve",
  });
  assert.equal(reviewed.response.status, 200);

  const inbox = await send("/api/notifications/me", employeeB.token);
  assert.equal(inbox.response.status, 200);
  assert.equal(inbox.body.unreadCount, 1);
  assert.equal(inbox.body.notifications[0].type, "CORRECTION_APPROVED");
  assert.match(inbox.body.notifications[0].linkUrl, /\/corrections\//);

  const tenantBInbox = await send("/api/notifications/me", tenantB.ownerToken);
  assert.equal(tenantBInbox.response.status, 200);
  assert.equal(
    tenantBInbox.body.notifications.some(
      (row) => row.id === inbox.body.notifications[0].id,
    ),
    false,
  );

  const invalidLimit = await send("/api/notifications/me?limit=0", employeeB.token);
  assert.equal(invalidLimit.response.status, 400);
});
