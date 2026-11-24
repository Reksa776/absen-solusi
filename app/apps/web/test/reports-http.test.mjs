import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomInt, randomUUID } from "node:crypto";
import { join } from "node:path";
import test, { after, before } from "node:test";

import {
  adminClient,
  resetDatabase,
  seedHolidays,
  seedMember,
  seedTenant,
} from "../../../packages/auth/dist/test-support.js";

const root = new URL("../../../", import.meta.url).pathname;
const OFFICE = { latitude: -6.2, longitude: 106.8, radiusMeters: 100 };

let db;
let server;
let baseUrl;
let tenantA;
let tenantB;
let employeeA1;
let employeeA2;
let employeeA3;

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

async function get(path, token) {
  const response = await fetch(`${baseUrl}${path}`, {
    headers: { authorization: `Bearer ${token}`, connection: "close" },
  });
  return { response, body: await response.json() };
}

async function createAttendance(memberId, tenantId, date, type, timestamp) {
  await db.attendanceLog.create({
    data: {
      id: randomUUID(),
      tenantId,
      memberId,
      workDate: new Date(`${date}T00:00:00.000Z`),
      type,
      timestampServer: new Date(timestamp),
      latitude: OFFICE.latitude,
      longitude: OFFICE.longitude,
      accuracyMeters: 5,
      distanceMeters: 0,
      isMockLocation: false,
      photoUrl: "/uploads/attendance/x.jpg",
      photoHash: "c".repeat(64),
    },
  });
}

before(async () => {
  db = adminClient();
  await resetDatabase(db);
  tenantA = await seedTenant(db, { name: "Reports A" });
  tenantB = await seedTenant(db, { name: "Reports B" });
  employeeA1 = await seedMember(db, tenantA.tenantId, tenantA.roles.VIEWER);
  employeeA2 = await seedMember(db, tenantA.tenantId, tenantA.roles.VIEWER);
  employeeA3 = await seedMember(db, tenantA.tenantId, tenantA.roles.VIEWER);

  for (const [tenantId, name] of [
    [tenantA.tenantId, "Reports A HQ"],
    [tenantB.tenantId, "Reports B HQ"],
  ]) {
    await db.officeLocation.create({
      data: {
        id: randomUUID(),
        tenantId,
        name,
        ...OFFICE,
        timezone: "UTC",
        workStart: "09:00",
        workEnd: "17:00",
      },
    });
  }

  await seedHolidays(db, tenantA.tenantId, [
    { date: "2026-12-25", name: "Hari Raya Natal" },
    { date: "2027-01-01", name: "Tahun Baru" },
    { date: "2026-12-24", name: "Cuti bersama Natal" },
    { date: "2026-11-16", name: "Libur uji November" },
  ]);

  // Data rekap November 2026 (bulan berjalan saat verifikasi).
  await createAttendance(
    employeeA1.memberId,
    tenantA.tenantId,
    "2026-11-02",
    "CHECK_IN",
    "2026-11-02T08:55:00.000Z",
  );
  await createAttendance(
    employeeA1.memberId,
    tenantA.tenantId,
    "2026-11-02",
    "CHECK_OUT",
    "2026-11-02T17:05:00.000Z",
  );
  await createAttendance(
    employeeA2.memberId,
    tenantA.tenantId,
    "2026-11-02",
    "CHECK_IN",
    "2026-11-02T09:30:00.000Z",
  );
  await createAttendance(
    employeeA3.memberId,
    tenantA.tenantId,
    "2026-11-02",
    "CHECK_IN",
    "2026-11-02T09:00:00.000Z",
  );
  await createAttendance(
    employeeA3.memberId,
    tenantA.tenantId,
    "2026-11-02",
    "CHECK_OUT",
    "2026-11-02T08:30:00.000Z",
  );

  // Skenario 1 Desember 2026: tepat waktu, terlambat + masih di kantor, absen.
  await createAttendance(
    employeeA1.memberId,
    tenantA.tenantId,
    "2026-12-01",
    "CHECK_IN",
    "2026-12-01T08:55:00.000Z",
  );
  await createAttendance(
    employeeA1.memberId,
    tenantA.tenantId,
    "2026-12-01",
    "CHECK_OUT",
    "2026-12-01T17:05:00.000Z",
  );
  await createAttendance(
    employeeA2.memberId,
    tenantA.tenantId,
    "2026-12-01",
    "CHECK_IN",
    "2026-12-01T09:30:00.000Z",
  );

  await db.correctionRequest.create({
    data: {
      id: randomUUID(),
      tenantId: tenantA.tenantId,
      memberId: employeeA1.memberId,
      requestType: "CHECK_IN",
      requestedTimestamp: new Date("2026-12-01T08:55:00.000Z"),
      reason: "Lupa check-in karena jaringan kantor terputus",
      status: "PENDING",
    },
  });

  const port = 4400 + randomInt(400);
  baseUrl = `http://127.0.0.1:${port}`;
  server = spawn(join(root, "node_modules", ".bin", "next"), ["start", "-p", String(port)], {
    cwd: join(root, "apps", "web"),
    env: {
      ...process.env,
      NODE_ENV: "production",
      S1_RATE_LIMITER: "memory",
      LATE_TOLERANCE_MINUTES: "15",
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

test("C-DASH-1: dashboard menghitung campuran tepat waktu, terlambat, absen, on-site", async () => {
  const result = await get(
    `/api/workspaces/${tenantA.tenantId}/dashboard/today?date=2026-12-01`,
    tenantA.ownerToken,
  );
  assert.equal(result.response.status, 200);
  assert.equal(result.body.date, "2026-12-01");
  assert.equal(result.body.totalMembers, 4);
  assert.equal(result.body.checkedIn, 2);
  assert.equal(result.body.late, 1);
  // Owner dan employeeA3 sama-sama tidak punya check-in.
  assert.equal(result.body.absent, 2);
  assert.equal(result.body.onSite, 1);
  assert.equal(result.body.correctionsPending, 1);
  assert.equal(result.body.holiday, null);

  const rows = new Map(result.body.members.map((row) => [row.memberId, row]));
  assert.equal(rows.get(employeeA1.memberId).status, "PRESENT");
  assert.equal(rows.get(employeeA2.memberId).status, "ON_SITE");
  assert.equal(rows.get(employeeA2.memberId).lateMinutes, 15);
  assert.equal(rows.get(employeeA3.memberId).status, "ABSENT");
  assert.equal(rows.get(tenantA.ownerMemberId).status, "ABSENT");
});

test("C-DASH-2: hari libur dari tabel membuat absen nol dan status HOLIDAY", async () => {
  const result = await get(
    `/api/workspaces/${tenantA.tenantId}/dashboard/today?date=2026-12-25`,
    tenantA.ownerToken,
  );
  assert.equal(result.response.status, 200);
  assert.equal(result.body.holiday, "Hari Raya Natal");
  assert.equal(result.body.totalMembers, 4);
  assert.equal(result.body.checkedIn, 0);
  assert.equal(result.body.absent, 0);
  assert.equal(
    result.body.members.every((row) => row.status === "HOLIDAY"),
    true,
  );

  const regular = await get(
    `/api/workspaces/${tenantA.tenantId}/dashboard/today?date=2026-12-24`,
    tenantA.ownerToken,
  );
  assert.equal(regular.body.holiday, "Cuti bersama Natal");
  assert.equal(regular.body.absent, 0);
});

test("C-REP-1: rekap bulanan menghitung jam kerja, keterlambatan, libur, dan anomali", async () => {
  const result = await get(
    `/api/workspaces/${tenantA.tenantId}/reports/monthly?year=2026&month=11`,
    tenantA.ownerToken,
  );
  assert.equal(result.response.status, 200);
  assert.equal(result.body.year, 2026);
  assert.equal(result.body.month, 11);
  assert.equal(result.body.members.length, 4);

  const byId = new Map(result.body.members.map((member) => [member.memberId, member]));
  const onTime = byId.get(employeeA1.memberId);
  assert.equal(onTime.days.length, 30);
  const onTimeDay = onTime.days.find((day) => day.date === "2026-11-02");
  assert.equal(onTimeDay.status, "PRESENT");
  assert.equal(onTimeDay.workHours, 7.17);
  assert.equal(onTimeDay.late, 0);
  assert.equal(onTime.totalWorkHours, 7.17);
  assert.equal(onTime.totalLate, 0);

  const late = byId.get(employeeA2.memberId);
  const lateDay = late.days.find((day) => day.date === "2026-11-02");
  assert.equal(lateDay.status, "INCOMPLETE");
  assert.equal(lateDay.workHours, 0);
  assert.equal(lateDay.late, 15);
  assert.equal(late.totalLate, 15);

  const anomaly = byId.get(employeeA3.memberId);
  const anomalyDay = anomaly.days.find((day) => day.date === "2026-11-02");
  assert.equal(anomalyDay.status, "ANOMALY");
  assert.equal(anomalyDay.workHours, 0);
  assert.equal(
    anomaly.days.every((day) => day.workHours >= 0),
    true,
  );
  assert.equal(anomaly.days.find((day) => day.date === "2026-11-16").status, "HOLIDAY");
  assert.equal(anomaly.days.find((day) => day.date === "2026-11-07").status, "WEEKEND");
  assert.equal(anomaly.days.find((day) => day.date === "2026-11-03").status, "ABSENT");
  // Status FUTURE bergantung pada tanggal berjalan; cek hari kerja mendatang
  // pertama agar test tidak bergantung pada tanggal eksekusi suite.
  const today = new Date();
  const upcoming = anomaly.days.find(
    (day) =>
      new Date(`${day.date}T00:00:00.000Z`) > today &&
      day.status !== "WEEKEND" &&
      day.status !== "HOLIDAY",
  );
  if (upcoming) assert.equal(upcoming.status, "FUTURE");
});

test("C-REP-2: filter member dan validasi parameter", async () => {
  const filtered = await get(
    `/api/workspaces/${tenantA.tenantId}/reports/monthly?year=2026&month=11&memberId=${employeeA1.memberId}`,
    tenantA.ownerToken,
  );
  assert.equal(filtered.response.status, 200);
  assert.deepEqual(
    filtered.body.members.map((member) => member.memberId),
    [employeeA1.memberId],
  );

  const missing = await get(
    `/api/workspaces/${tenantA.tenantId}/reports/monthly?year=2026`,
    tenantA.ownerToken,
  );
  assert.equal(missing.response.status, 400);
  assert.equal(missing.body.error.code, "INVALID_MONTH");

  const badMonth = await get(
    `/api/workspaces/${tenantA.tenantId}/reports/monthly?year=2026&month=13`,
    tenantA.ownerToken,
  );
  assert.equal(badMonth.response.status, 400);

  const foreign = await get(
    `/api/workspaces/${tenantB.tenantId}/reports/monthly?year=2026&month=11`,
    tenantA.ownerToken,
  );
  const absent = await get(
    "/api/workspaces/00000000-0000-4000-8000-000000000000/reports/monthly?year=2026&month=11",
    tenantA.ownerToken,
  );
  assert.equal(foreign.response.status, 403);
  assert.deepEqual(foreign.body, absent.body);
});

test("C-CSV-1: export CSV header benar, tanpa data sensitif, dan audit tercatat", async () => {
  const response = await fetch(
    `${baseUrl}/api/workspaces/${tenantA.tenantId}/reports/monthly/export?year=2026&month=11&format=csv`,
    { headers: { authorization: `Bearer ${tenantA.ownerToken}`, connection: "close" } },
  );
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /text\/csv/);
  assert.equal(
    response.headers.get("content-disposition"),
    'attachment; filename="rekap-2026-11.csv"',
  );

  // Streaming: tanpa content-length, dikirim chunked.
  assert.equal(response.headers.get("content-length"), null);
  assert.equal(response.headers.get("transfer-encoding"), "chunked");

  const csv = await response.text();
  const lines = csv.trim().split("\r\n");
  assert.equal(
    lines[0],
    "member_name,date,check_in,check_out,work_hours,late_minutes,status",
  );
  assert.equal(lines.length, 121);
  assert.equal(csv.includes("@test.local"), false);
  assert.equal(csv.includes("/uploads/"), false);
  assert.equal(csv.includes("proof"), false);
  assert.equal(csv.includes("latitude"), false);
  assert.match(
    csv,
    /2026-11-02,2026-11-02T08:55:00\.000Z,2026-11-02T17:05:00\.000Z,7\.17,0,PRESENT/,
  );

  const audit = await db.auditLog.findFirstOrThrow({
    where: { action: "report.export" },
    orderBy: { createdAt: "desc" },
  });
  assert.equal(audit.tenantId, tenantA.tenantId);
  assert.equal(audit.actorUserId, tenantA.ownerUserId);
  assert.equal(audit.actorMemberId, tenantA.ownerMemberId);
  assert.equal(audit.ipHash?.length, 32);
  assert.equal(audit.resourceId, tenantA.tenantId);
  assert.equal(audit.metadata.resourceId, tenantA.tenantId);
  assert.deepEqual(Object.keys(audit.metadata).sort(), [
    "format",
    "month",
    "resourceId",
    "year",
  ]);
  const serialized = JSON.stringify(audit.metadata);
  assert.equal(serialized.includes("@test.local"), false);
  assert.equal(serialized.includes("2026-11-02"), false);
});

test("C-CSV-2: format selain csv ditolak dan cross-tenant 403", async () => {
  const invalid = await get(
    `/api/workspaces/${tenantA.tenantId}/reports/monthly/export?year=2026&month=11&format=json`,
    tenantA.ownerToken,
  );
  assert.equal(invalid.response.status, 400);
  assert.equal(invalid.body.error.code, "INVALID_FORMAT");

  const foreign = await fetch(
    `${baseUrl}/api/workspaces/${tenantB.tenantId}/reports/monthly/export?year=2026&month=11`,
    { headers: { authorization: `Bearer ${tenantA.ownerToken}`, connection: "close" } },
  );
  assert.equal(foreign.status, 403);
  const foreignBody = await foreign.json();
  const missing = await get(
    "/api/workspaces/00000000-0000-4000-8000-000000000000/reports/monthly/export?year=2026&month=11",
    tenantA.ownerToken,
  );
  assert.equal(missing.response.status, 403);
  assert.deepEqual(foreignBody, missing.body);
});

test("C-LATE-1: statistik keterlambatan menghitung campuran data", async () => {
  const result = await get(
    `/api/workspaces/${tenantA.tenantId}/reports/late-stats?year=2026&month=11`,
    tenantA.ownerToken,
  );
  assert.equal(result.response.status, 200);
  assert.equal(result.body.totalLate, 1);
  assert.deepEqual(result.body.lateByDay, [{ date: "2026-11-02", count: 1 }]);
  assert.equal(result.body.lateByMember.length, 1);
  assert.equal(result.body.lateByMember[0].memberId, employeeA2.memberId);
  assert.equal(result.body.lateByMember[0].count, 1);
  assert.equal(result.body.averageLateMinutes, 15);

  const foreign = await get(
    `/api/workspaces/${tenantB.tenantId}/reports/late-stats?year=2026&month=11`,
    tenantA.ownerToken,
  );
  const missing = await get(
    "/api/workspaces/00000000-0000-4000-8000-000000000000/reports/late-stats?year=2026&month=11",
    tenantA.ownerToken,
  );
  assert.equal(foreign.response.status, 403);
  assert.deepEqual(foreign.body, missing.body);
});

test("C-FILTER-1: rekap mendukung rentang tanggal, status, dan pagination", async () => {
  const range = await get(
    `/api/workspaces/${tenantA.tenantId}/reports/monthly?year=2026&month=11&from=2026-11-02&to=2026-11-02&memberId=${employeeA1.memberId}`,
    tenantA.ownerToken,
  );
  assert.equal(range.response.status, 200);
  assert.equal(range.body.members.length, 1);
  assert.deepEqual(
    range.body.members[0].days.map((day) => day.date),
    ["2026-11-02"],
  );
  assert.equal(range.body.members[0].totalWorkHours, 7.17);

  const present = await get(
    `/api/workspaces/${tenantA.tenantId}/reports/monthly?year=2026&month=11&status=PRESENT&memberId=${employeeA1.memberId}`,
    tenantA.ownerToken,
  );
  assert.equal(present.response.status, 200);
  assert.equal(present.body.members[0].days.length, 1);
  assert.equal(present.body.members[0].days[0].status, "PRESENT");
  assert.equal(present.body.members[0].totalAbsent, 0);

  const paged = await get(
    `/api/workspaces/${tenantA.tenantId}/reports/monthly?year=2026&month=11&limit=1&offset=1`,
    tenantA.ownerToken,
  );
  assert.equal(paged.response.status, 200);
  assert.equal(paged.body.members.length, 1);
  assert.deepEqual(paged.body.pagination, { limit: 1, offset: 1, total: 4 });

  const tooBig = await get(
    `/api/workspaces/${tenantA.tenantId}/reports/monthly?year=2026&month=11&limit=101`,
    tenantA.ownerToken,
  );
  assert.equal(tooBig.response.status, 400);
  assert.equal(tooBig.body.error.code, "INVALID_PAGINATION");

  const badRange = await get(
    `/api/workspaces/${tenantA.tenantId}/reports/monthly?year=2026&month=11&from=2026-11-05&to=2026-11-01`,
    tenantA.ownerToken,
  );
  assert.equal(badRange.response.status, 400);
  assert.equal(badRange.body.error.code, "INVALID_DATE_RANGE");
});

test("C-FILTER-2: dashboard mendukung filter member/status dan pagination", async () => {
  const byMember = await get(
    `/api/workspaces/${tenantA.tenantId}/dashboard/today?date=2026-12-01&memberId=${employeeA1.memberId}`,
    tenantA.ownerToken,
  );
  assert.equal(byMember.response.status, 200);
  assert.equal(byMember.body.members.length, 1);
  assert.equal(byMember.body.members[0].memberId, employeeA1.memberId);
  assert.equal(byMember.body.totalMembers, 4);
  assert.deepEqual(byMember.body.pagination, { limit: 50, offset: 0, total: 4 });

  const absent = await get(
    `/api/workspaces/${tenantA.tenantId}/dashboard/today?date=2026-12-01&status=ABSENT`,
    tenantA.ownerToken,
  );
  assert.equal(absent.response.status, 200);
  assert.equal(absent.body.members.length, 2);
  assert.equal(absent.body.members.every((row) => row.status === "ABSENT"), true);

  const limited = await get(
    `/api/workspaces/${tenantA.tenantId}/dashboard/today?date=2026-12-01&limit=101`,
    tenantA.ownerToken,
  );
  assert.equal(limited.response.status, 400);
  assert.equal(limited.body.error.code, "INVALID_PAGINATION");
});

test("C-DASH-3: tenant asing dan workspace tidak ada sama-sama 403 identik", async () => {
  const foreign = await get(
    `/api/workspaces/${tenantB.tenantId}/dashboard/today`,
    tenantA.ownerToken,
  );
  const missing = await get(
    "/api/workspaces/00000000-0000-4000-8000-000000000000/dashboard/today",
    tenantA.ownerToken,
  );
  assert.equal(foreign.response.status, 403);
  assert.equal(missing.response.status, 403);
  assert.deepEqual(foreign.body, missing.body);

  const nonAdmin = await get(
    `/api/workspaces/${tenantA.tenantId}/dashboard/today`,
    employeeA1.token,
  );
  assert.equal(nonAdmin.response.status, 403);
});
