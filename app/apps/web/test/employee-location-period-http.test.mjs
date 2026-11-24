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
const PASSWORD = "KaryawanBaru#2026";

let db;
let server;
let baseUrl;
let tenant;
let admin;
let summaryEmployee;
let divisionId;
let positionId;

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

async function attendance(memberId, date, type, timestamp) {
  await db.attendanceLog.create({
    data: {
      id: randomUUID(),
      tenantId: tenant.tenantId,
      memberId,
      workDate: new Date(`${date}T00:00:00.000Z`),
      type,
      timestampServer: new Date(timestamp),
      latitude: -6.732,
      longitude: 108.5523,
      accuracyMeters: 5,
      distanceMeters: 0,
      isMockLocation: false,
      photoUrl: "/uploads/attendance/test.jpg",
      photoHash: "e".repeat(64),
    },
  });
}

before(async () => {
  db = adminClient();
  await resetDatabase(db);
  tenant = await seedTenant(db, { name: "Employee Period" });
  admin = await seedMember(db, tenant.tenantId, tenant.roles.WORKSPACE_ADMIN);
  summaryEmployee = await seedMember(db, tenant.tenantId, tenant.roles.EMPLOYEE);

  divisionId = randomUUID();
  await db.division.create({
    data: { id: divisionId, tenantId: tenant.tenantId, name: "Operasional" },
  });
  positionId = randomUUID();
  await db.position.create({
    data: {
      id: positionId,
      tenantId: tenant.tenantId,
      divisionId,
      name: "Staf Lapangan",
    },
  });
  await db.workspaceMember.update({
    where: {
      tenantId_id: { tenantId: tenant.tenantId, id: summaryEmployee.memberId },
    },
    data: { divisionId },
  });

  const patternId = randomUUID();
  await db.workPattern.create({
    data: {
      id: patternId,
      tenantId: tenant.tenantId,
      name: "Reguler",
      timezone: "Asia/Jakarta",
      days: {
        create: Array.from({ length: 7 }, (_, dayOfWeek) => ({
          id: randomUUID(),
          dayOfWeek,
          isWorkday: true,
          startTime: "09:00",
          endTime: "17:00",
          earliestCheckInMinutes: 120,
          lateToleranceMinutes: 15,
        })),
      },
    },
  });
  await db.workPatternAssignment.create({
    data: {
      id: randomUUID(),
      tenantId: tenant.tenantId,
      memberId: summaryEmployee.memberId,
      workPatternId: patternId,
    },
  });

  await attendance(summaryEmployee.memberId, "2026-10-26", "CHECK_IN", "2026-10-26T01:55:00.000Z");
  await attendance(summaryEmployee.memberId, "2026-10-26", "CHECK_OUT", "2026-10-26T10:05:00.000Z");
  await attendance(summaryEmployee.memberId, "2026-10-30", "CHECK_IN", "2026-10-30T02:30:00.000Z");
  await attendance(summaryEmployee.memberId, "2026-10-30", "CHECK_OUT", "2026-10-30T09:00:00.000Z");
  await db.leaveRequest.create({
    data: {
      id: randomUUID(),
      tenantId: tenant.tenantId,
      memberId: summaryEmployee.memberId,
      leaveType: "TAHUNAN",
      startDate: new Date("2026-10-31T00:00:00.000Z"),
      endDate: new Date("2026-10-31T00:00:00.000Z"),
      workingDays: 1,
      reason: "Keperluan keluarga",
      status: "APPROVED",
    },
  });
  await db.workPermit.create({
    data: {
      id: randomUUID(),
      tenantId: tenant.tenantId,
      memberId: summaryEmployee.memberId,
      permitType: "IZIN_KERJA",
      startDate: new Date("2026-11-01T00:00:00.000Z"),
      endDate: new Date("2026-11-01T00:00:00.000Z"),
      reason: "Tugas luar kantor",
      status: "APPROVED",
    },
  });

  const port = 4700 + randomInt(250);
  baseUrl = `http://127.0.0.1:${port}`;
  server = spawn(join(root, "node_modules", ".bin", "next"), ["start", "-p", String(port)], {
    cwd: join(root, "apps", "web"),
    env: { ...process.env, NODE_ENV: "production", S1_RATE_LIMITER: "memory" },
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

test("EMP-1: tambah/edit karyawan tanpa role memakai role EMPLOYEE", async () => {
  const email = `employee-${randomUUID()}@test.local`;
  const created = await send(
    `/api/workspaces/${tenant.tenantId}/members/direct`,
    admin.token,
    "POST",
    {
      name: "Karyawan Tanpa Role",
      email,
      password: PASSWORD,
      status: "ACTIVE",
      divisionId,
      positionId,
      role: "WORKSPACE_ADMIN",
    },
  );
  assert.equal(created.response.status, 201, JSON.stringify(created.body));
  assert.equal(created.body.roleKey, "EMPLOYEE");
  assert.equal(created.body.divisionId, divisionId);
  assert.equal(created.body.positionId, positionId);

  const member = await db.workspaceMember.findFirstOrThrow({
    where: { tenantId: tenant.tenantId, id: created.body.memberId },
    include: { roles: { include: { role: true } } },
  });
  assert.deepEqual(member.roles.map((row) => row.role.key), ["EMPLOYEE"]);

  const updated = await send(
    `/api/workspaces/${tenant.tenantId}/members/${member.id}/employee`,
    admin.token,
    "PATCH",
    {
      name: "Karyawan Diperbarui",
      status: "INACTIVE",
      divisionId: null,
      positionId: null,
    },
  );
  assert.equal(updated.response.status, 200, JSON.stringify(updated.body));
  assert.equal(updated.body.status, "INACTIVE");
  assert.equal(updated.body.divisionId, null);

  const user = await db.user.findUniqueOrThrow({ where: { email } });
  assert.equal(user.name, "Karyawan Diperbarui");
  const audit = await db.auditLog.findFirst({
    where: { action: "member.update", resourceId: member.id },
  });
  assert.ok(audit);
});

test("LOC-1: URL Google Maps mengisi koordinat dan disimpan bersama kantor", async () => {
  const payload = {
    name: "Kantor Shareloc",
    address: "Jl. Raya",
    googleMapsUrl: "https://www.google.com/maps?q=-6.7320,108.5523",
    radiusMeters: 100,
    timezone: "Asia/Jakarta",
    workStart: "09:00",
    workEnd: "17:00",
  };
  const created = await send(
    `/api/workspaces/${tenant.tenantId}/office`,
    admin.token,
    "POST",
    payload,
  );
  assert.equal(created.response.status, 201, JSON.stringify(created.body));
  assert.equal(created.body.googleMapsUrl, payload.googleMapsUrl);
  assert.equal(created.body.latitude, -6.732);
  assert.equal(created.body.longitude, 108.5523);

  const patched = await send(
    `/api/workspaces/${tenant.tenantId}/office/${created.body.id}`,
    admin.token,
    "PATCH",
    { googleMapsUrl: "https://www.google.com/maps/@-6.75,108.60,17z" },
  );
  assert.equal(patched.response.status, 200);
  assert.equal(patched.body.latitude, -6.75);
  assert.equal(patched.body.longitude, 108.6);

  const rejected = await send(
    `/api/workspaces/${tenant.tenantId}/office`,
    admin.token,
    "POST",
    { ...payload, name: "Host Asing", googleMapsUrl: "https://evil.example/maps?q=-6.7,108.5" },
  );
  assert.equal(rejected.response.status, 400);
  assert.equal(rejected.body.error.code, "INVALID_GOOGLE_MAPS_URL");
});

test("PERIOD-1: ringkasan rentang tanggal, status, CSV, dan audit", async () => {
  const summary = await send(
    `/api/workspaces/${tenant.tenantId}/attendance/summary?startDate=2026-10-26&endDate=2026-11-01`,
    admin.token,
  );
  assert.equal(summary.response.status, 200, JSON.stringify(summary.body));
  assert.equal(summary.body.startDate, "2026-10-26");
  assert.equal(summary.body.endDate, "2026-11-01");
  const row = summary.body.members.find((entry) => entry.memberId === summaryEmployee.memberId);
  assert.ok(row);
  assert.equal(row.presentDays, 2);
  assert.equal(row.onTimeDays, 1);
  assert.equal(row.lateMinutes, 15);
  assert.equal(row.earlyLeaveDays, 1);
  assert.equal(row.leaveDays, 1);
  assert.equal(row.permitDays, 1);
  assert.equal(row.absentDays, 3);

  const csv = await fetch(
    `${baseUrl}/api/workspaces/${tenant.tenantId}/attendance/summary/export?startDate=2026-10-26&endDate=2026-11-01`,
    { headers: { authorization: `Bearer ${admin.token}`, connection: "close" } },
  );
  assert.equal(csv.status, 200);
  assert.match(csv.headers.get("content-disposition") ?? "", /ringkasan-kehadiran/);
  const lines = (await csv.text()).trim().split("\r\n");
  assert.match(lines[0], /^member_name,division,present_days,on_time_days/);
  const summaryLine = lines.find((line) => line.startsWith("Member,Operasional,"));
  assert.equal(summaryLine, "Member,Operasional,2,1,15,1,1,1,0,3");

  const audit = await db.auditLog.findFirst({
    where: { action: "report.export" },
    orderBy: { createdAt: "desc" },
  });
  assert.equal(audit.metadata.report, "attendance_period");

  const invalid = await send(
    `/api/workspaces/${tenant.tenantId}/attendance/summary?startDate=2026-11-02&endDate=2026-10-26`,
    admin.token,
  );
  assert.equal(invalid.response.status, 400);
  assert.equal(invalid.body.error.code, "INVALID_DATE_RANGE");
});

test("NOTIF-1: approve/reject revisi membuat notifikasi dengan tanggal dan catatan", async () => {
  const approvedId = randomUUID();
  await db.correctionRequest.create({
    data: {
      id: approvedId,
      tenantId: tenant.tenantId,
      memberId: summaryEmployee.memberId,
      requestType: "CHECK_IN",
      requestedTimestamp: new Date("2026-11-20T01:55:00.000Z"),
      reason: "Lupa check-in karena jaringan kantor terputus",
      status: "PENDING",
    },
  });
  const approved = await send(`/api/corrections/${approvedId}`, admin.token, "PATCH", {
    action: "approve",
  });
  assert.equal(approved.response.status, 200, JSON.stringify(approved.body));

  const rejectedId = randomUUID();
  await db.correctionRequest.create({
    data: {
      id: rejectedId,
      tenantId: tenant.tenantId,
      memberId: summaryEmployee.memberId,
      requestType: "CHECK_OUT",
      requestedTimestamp: new Date("2026-11-21T10:00:00.000Z"),
      reason: "Ingin memperbaiki jam pulang karena lupa absen",
      status: "PENDING",
    },
  });
  const reason = "Bukti tidak sesuai dengan jam kantor";
  const rejected = await send(`/api/corrections/${rejectedId}`, admin.token, "PATCH", {
    action: "reject",
    rejectionReason: reason,
  });
  assert.equal(rejected.response.status, 200, JSON.stringify(rejected.body));

  const inbox = await send("/api/notifications/me?limit=20", summaryEmployee.token);
  assert.equal(inbox.response.status, 200);
  const approvedNotice = inbox.body.notifications.find(
    (row) => row.type === "CORRECTION_APPROVED",
  );
  assert.ok(approvedNotice);
  assert.match(approvedNotice.title, /2026-11-20/);
  assert.match(approvedNotice.title, /disetujui/i);
  assert.match(approvedNotice.body, /2026-11-20/);
  const rejectedNotice = inbox.body.notifications.find(
    (row) => row.type === "CORRECTION_REJECTED",
  );
  assert.ok(rejectedNotice);
  assert.match(rejectedNotice.title, /2026-11-21/);
  assert.match(rejectedNotice.title, /ditolak/i);
  assert.match(rejectedNotice.body, new RegExp(reason));
});
