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
let tenantA;
let tenantB;
let adminA;
let employeeA1;
let employeeA2;
let divisionOps;
let divisionFinance;
let positionSupervisor;
let positionStaff;

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

async function createAttendance(memberId, date, type, timestamp) {
  await db.attendanceLog.create({
    data: {
      id: randomUUID(),
      tenantId: tenantA.tenantId,
      memberId,
      workDate: new Date(`${date}T00:00:00.000Z`),
      type,
      timestampServer: new Date(timestamp),
      latitude: -6.2,
      longitude: 106.8,
      accuracyMeters: 5,
      distanceMeters: 0,
      isMockLocation: false,
      photoUrl: "/uploads/attendance/x.jpg",
      photoHash: "d".repeat(64),
    },
  });
}

before(async () => {
  db = adminClient();
  await resetDatabase(db);
  tenantA = await seedTenant(db, { name: "Organization A" });
  tenantB = await seedTenant(db, { name: "Organization B" });
  adminA = await seedMember(db, tenantA.tenantId, tenantA.roles.WORKSPACE_ADMIN);
  employeeA1 = await seedMember(db, tenantA.tenantId, tenantA.roles.VIEWER);
  employeeA2 = await seedMember(db, tenantA.tenantId, tenantA.roles.VIEWER);

  await createAttendance(
    employeeA1.memberId,
    "2026-11-02",
    "CHECK_IN",
    "2026-11-02T08:55:00.000Z",
  );
  await createAttendance(
    employeeA1.memberId,
    "2026-11-02",
    "CHECK_OUT",
    "2026-11-02T17:05:00.000Z",
  );
  await createAttendance(
    employeeA2.memberId,
    "2026-11-02",
    "CHECK_IN",
    "2026-11-02T09:30:00.000Z",
  );

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

test("C-ORG-1: CRUD divisi & jabatan, validasi, audit, dan permission", async () => {
  const empty = await send(`/api/workspaces/${tenantA.tenantId}/divisions`, adminA.token);
  assert.equal(empty.response.status, 200);
  assert.deepEqual(empty.body.divisions, []);

  const created = await send(
    `/api/workspaces/${tenantA.tenantId}/divisions`,
    adminA.token,
    "POST",
    { name: "Operasional", code: "OPS", description: "Layanan harian" },
  );
  assert.equal(created.response.status, 201);
  divisionOps = created.body.id;
  assert.equal(created.body.name, "Operasional");
  assert.equal(created.body.memberCount, 0);
  assert.equal(created.body.positionCount, 0);

  const finance = await send(
    `/api/workspaces/${tenantA.tenantId}/divisions`,
    adminA.token,
    "POST",
    { name: "Keuangan" },
  );
  assert.equal(finance.response.status, 201);
  divisionFinance = finance.body.id;

  const duplicate = await send(
    `/api/workspaces/${tenantA.tenantId}/divisions`,
    adminA.token,
    "POST",
    { name: "Operasional" },
  );
  assert.equal(duplicate.response.status, 409);
  assert.equal(duplicate.body.error.code, "DIVISION_EXISTS");

  const supervisor = await send(
    `/api/workspaces/${tenantA.tenantId}/positions`,
    adminA.token,
    "POST",
    { name: "Supervisor", divisionId: divisionOps },
  );
  assert.equal(supervisor.response.status, 201);
  positionSupervisor = supervisor.body.id;
  assert.equal(supervisor.body.divisionName, "Operasional");

  const staff = await send(
    `/api/workspaces/${tenantA.tenantId}/positions`,
    adminA.token,
    "POST",
    { name: "Staf Umum" },
  );
  assert.equal(staff.response.status, 201);
  positionStaff = staff.body.id;
  assert.equal(staff.body.divisionId, null);

  const badDivision = await send(
    `/api/workspaces/${tenantA.tenantId}/positions`,
    adminA.token,
    "POST",
    { name: "Jabatan Yatim", divisionId: randomUUID() },
  );
  assert.equal(badDivision.response.status, 404);
  assert.equal(badDivision.body.error.code, "DIVISION_NOT_FOUND");

  const employeeList = await send(
    `/api/workspaces/${tenantA.tenantId}/positions`,
    employeeA1.token,
  );
  assert.equal(employeeList.response.status, 200);
  assert.equal(employeeList.body.positions.length, 2);

  const employeeCreate = await send(
    `/api/workspaces/${tenantA.tenantId}/divisions`,
    employeeA1.token,
    "POST",
    { name: "Tidak Boleh" },
  );
  assert.equal(employeeCreate.response.status, 403);

  const foreign = await send(`/api/workspaces/${tenantB.tenantId}/divisions`, tenantA.ownerToken);
  assert.equal(foreign.response.status, 403);

  const audit = await db.auditLog.findFirstOrThrow({
    where: { action: "organization.division_create", resourceId: divisionOps },
  });
  assert.equal(audit.tenantId, tenantA.tenantId);
  assert.deepEqual(audit.metadata, {
    name: "Operasional",
    code: "OPS",
    isActive: true,
  });
});

test("C-ORG-2: penugasan karyawan tersinkron ke daftar member dan mobile", async () => {
  const assigned = await send(
    `/api/workspaces/${tenantA.tenantId}/members/${employeeA1.memberId}/organization`,
    adminA.token,
    "PATCH",
    { divisionId: divisionOps, positionId: positionSupervisor },
  );
  assert.equal(assigned.response.status, 200);
  assert.equal(assigned.body.division.name, "Operasional");
  assert.equal(assigned.body.position.name, "Supervisor");

  // Jabatan terikat divisi menentukan divisi efektif.
  const positionWins = await send(
    `/api/workspaces/${tenantA.tenantId}/members/${employeeA1.memberId}/organization`,
    adminA.token,
    "PATCH",
    { divisionId: divisionFinance, positionId: positionSupervisor },
  );
  assert.equal(positionWins.response.status, 200);
  assert.equal(positionWins.body.division.name, "Operasional");

  const staffAssigned = await send(
    `/api/workspaces/${tenantA.tenantId}/members/${employeeA2.memberId}/organization`,
    adminA.token,
    "PATCH",
    { divisionId: divisionFinance, positionId: positionStaff },
  );
  assert.equal(staffAssigned.response.status, 200);
  assert.equal(staffAssigned.body.division.name, "Keuangan");
  assert.equal(staffAssigned.body.position.name, "Staf Umum");

  const members = await send(`/api/workspaces/${tenantA.tenantId}/members`, adminA.token);
  assert.equal(members.response.status, 200);
  const row = members.body.members.find((entry) => entry.id === employeeA1.memberId);
  assert.equal(row.divisionName, "Operasional");
  assert.equal(row.positionName, "Supervisor");

  const mobile = await send("/api/mobile/profile", employeeA1.token);
  assert.equal(mobile.response.status, 200);
  assert.equal(mobile.body.division.name, "Operasional");
  assert.equal(mobile.body.position.name, "Supervisor");

  const employeeAssign = await send(
    `/api/workspaces/${tenantA.tenantId}/members/${employeeA1.memberId}/organization`,
    employeeA1.token,
    "PATCH",
    { divisionId: null, positionId: null },
  );
  assert.equal(employeeAssign.response.status, 403);

  const invalidMember = await send(
    `/api/workspaces/${tenantA.tenantId}/members/00000000-0000-4000-8000-000000000000/organization`,
    adminA.token,
    "PATCH",
    { divisionId: null, positionId: null },
  );
  assert.equal(invalidMember.response.status, 404);
  assert.equal(invalidMember.body.error.code, "MEMBER_NOT_FOUND");
});

test("C-ORG-3: filter divisi pada rekap, dashboard, dan CSV", async () => {
  const report = await send(
    `/api/workspaces/${tenantA.tenantId}/reports/monthly?year=2026&month=11&divisionId=${divisionOps}`,
    adminA.token,
  );
  assert.equal(report.response.status, 200);
  assert.deepEqual(
    report.body.members.map((member) => member.memberId),
    [employeeA1.memberId],
  );
  assert.equal(report.body.members[0].divisionName, "Operasional");

  const financeReport = await send(
    `/api/workspaces/${tenantA.tenantId}/reports/monthly?year=2026&month=11&divisionId=${divisionFinance}`,
    adminA.token,
  );
  assert.equal(financeReport.response.status, 200);
  assert.deepEqual(
    financeReport.body.members.map((member) => member.memberId),
    [employeeA2.memberId],
  );

  const dashboard = await send(
    `/api/workspaces/${tenantA.tenantId}/dashboard/today?date=2026-11-02&divisionId=${divisionOps}`,
    adminA.token,
  );
  assert.equal(dashboard.response.status, 200);
  assert.deepEqual(
    dashboard.body.members.map((member) => member.memberId),
    [employeeA1.memberId],
  );
  assert.equal(dashboard.body.members[0].divisionName, "Operasional");

  const csv = await fetch(
    `${baseUrl}/api/workspaces/${tenantA.tenantId}/reports/monthly/export?year=2026&month=11&format=csv&divisionId=${divisionOps}`,
    { headers: { authorization: `Bearer ${adminA.token}`, connection: "close" } },
  );
  assert.equal(csv.status, 200);
  const lines = (await csv.text()).trim().split("\r\n");
  // Satu member × 30 hari November, bukan seluruh workspace.
  assert.equal(lines.length, 31);
  assert.match(lines[1], /^Member,2026-11-01/);

  const invalid = await send(
    `/api/workspaces/${tenantA.tenantId}/reports/monthly?year=2026&month=11&divisionId=not-a-uuid`,
    adminA.token,
  );
  assert.equal(invalid.response.status, 400);
  assert.equal(invalid.body.error.code, "INVALID_DIVISION");
});

test("C-ORG-4: hapus ditolak saat masih dipakai, lalu berhasil setelah dilepas", async () => {
  const usedDivision = await send(
    `/api/workspaces/${tenantA.tenantId}/divisions/${divisionOps}`,
    adminA.token,
    "DELETE",
  );
  assert.equal(usedDivision.response.status, 409);
  assert.equal(usedDivision.body.error.code, "DIVISION_IN_USE");

  const usedPosition = await send(
    `/api/workspaces/${tenantA.tenantId}/positions/${positionSupervisor}`,
    adminA.token,
    "DELETE",
  );
  assert.equal(usedPosition.response.status, 409);
  assert.equal(usedPosition.body.error.code, "POSITION_IN_USE");

  const cleared = await send(
    `/api/workspaces/${tenantA.tenantId}/members/${employeeA1.memberId}/organization`,
    adminA.token,
    "PATCH",
    { divisionId: null, positionId: null },
  );
  assert.equal(cleared.response.status, 200);
  assert.equal(cleared.body.division, null);
  assert.equal(cleared.body.position, null);

  const mobile = await send("/api/mobile/profile", employeeA1.token);
  assert.equal(mobile.body.division, null);
  assert.equal(mobile.body.position, null);

  const deletedPosition = await send(
    `/api/workspaces/${tenantA.tenantId}/positions/${positionSupervisor}`,
    adminA.token,
    "DELETE",
  );
  assert.equal(deletedPosition.response.status, 200);
  assert.equal(deletedPosition.body.deleted, true);

  const deletedDivision = await send(
    `/api/workspaces/${tenantA.tenantId}/divisions/${divisionOps}`,
    adminA.token,
    "DELETE",
  );
  assert.equal(deletedDivision.response.status, 200);

  const foreignDelete = await send(
    `/api/workspaces/${tenantA.tenantId}/divisions/${divisionFinance}`,
    adminA.token,
    "DELETE",
  );
  assert.equal(foreignDelete.response.status, 409);

  await send(
    `/api/workspaces/${tenantA.tenantId}/members/${employeeA2.memberId}/organization`,
    adminA.token,
    "PATCH",
    { divisionId: null, positionId: null },
  );
  const financeDelete = await send(
    `/api/workspaces/${tenantA.tenantId}/divisions/${divisionFinance}`,
    adminA.token,
    "DELETE",
  );
  assert.equal(financeDelete.response.status, 200);

  const auditActions = await db.auditLog.findMany({
    where: {
      tenantId: tenantA.tenantId,
      action: {
        in: [
          "organization.member_assign",
          "organization.division_delete",
          "organization.position_delete",
        ],
      },
    },
    select: { action: true },
  });
  assert.equal(
    auditActions.some((entry) => entry.action === "organization.member_assign"),
    true,
  );
  assert.equal(
    auditActions.some((entry) => entry.action === "organization.division_delete"),
    true,
  );
  assert.equal(
    auditActions.some((entry) => entry.action === "organization.position_delete"),
    true,
  );
});
