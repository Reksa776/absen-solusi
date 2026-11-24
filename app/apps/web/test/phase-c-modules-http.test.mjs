import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomInt, randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after, before } from "node:test";
import ExcelJS from "exceljs";

import {
  adminClient,
  resetDatabase,
  seedMember,
  seedTenant,
} from "../../../packages/auth/dist/test-support.js";

const root = new URL("../../../", import.meta.url).pathname;
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 9, 8, 7, 0xff, 0xd9]);
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);
const GEOCODE_ADDRESS =
  "Jl. Uji No. 1, Kelurahan Uji, Kota Uji, Jawa Tengah 50123, Indonesia";
const now = new Date();
const YEAR = now.getUTCFullYear();
const MONTH = now.getUTCMonth() + 1;
const pad = (value) => String(value).padStart(2, "0");
const day = (value) => `${YEAR}-${pad(MONTH)}-${pad(value)}`;

let db;
let server;
let baseUrl;
let photoDir;
let logoDir;
let geocodeServer;
let tenantA;
let tenantB;
let employee;
let otherEmployee;
let clientId;
let scheduleId;

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

async function sendPhoto(path, token, fields, fileField = "photo") {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) form.set(key, value);
  form.set(fileField, new Blob([JPEG], { type: "image/jpeg" }), "kunjungan.jpg");
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, connection: "close" },
    body: form,
  });
  return { response, body: await response.json().catch(() => ({})) };
}

async function uploadLogo(token, bytes, filename, type) {
  const form = new FormData();
  form.append("logo", new Blob([bytes], { type }), filename);
  const response = await fetch(
    `${baseUrl}/api/workspaces/${tenantA.tenantId}/settings/company/logo`,
    {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, connection: "close" },
      body: form,
    },
  );
  return { response, body: await response.json().catch(() => ({})) };
}

before(async () => {
  db = adminClient();
  await resetDatabase(db);
  tenantA = await seedTenant(db, { name: "Phase C A" });
  tenantB = await seedTenant(db, { name: "Phase C B" });
  employee = await seedMember(db, tenantA.tenantId, tenantA.roles.EMPLOYEE);
  otherEmployee = await seedMember(db, tenantA.tenantId, tenantA.roles.EMPLOYEE);
  photoDir = await mkdtemp(join(tmpdir(), "absensi-phase-c-photo-"));
  logoDir = await mkdtemp(join(tmpdir(), "absensi-phase-c-logo-"));
  geocodeServer = createServer((_request, response) => {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ display_name: GEOCODE_ADDRESS }));
  });
  await new Promise((resolve) => geocodeServer.listen(0, "127.0.0.1", resolve));

  const officeId = randomUUID();
  await db.officeLocation.create({
    data: {
      id: officeId,
      tenantId: tenantA.tenantId,
      name: "Kantor Pusat",
      latitude: -6.2,
      longitude: 106.816666,
      radiusMeters: 150,
      timezone: "UTC",
      workStart: "08:00",
      workEnd: "17:00",
      isActive: true,
    },
  });
  await db.workspaceMember.update({
    where: {
      tenantId_id: { tenantId: tenantA.tenantId, id: employee.memberId },
    },
    data: { officeLocationId: officeId },
  });
  const attendanceBase = {
    tenantId: tenantA.tenantId,
    memberId: employee.memberId,
    workDate: new Date(`${day(2)}T00:00:00.000Z`),
    latitude: -6.2,
    longitude: 106.816666,
    accuracyMeters: 5,
    distanceMeters: 0,
    officeLocationId: officeId,
    workMode: "OFFICE",
    approvalStatus: "APPROVED",
    isMockLocation: false,
    photoUrl: "test://attendance",
    photoHash: "a".repeat(64),
  };
  await db.attendanceLog.createMany({
    data: [
      {
        ...attendanceBase,
        id: randomUUID(),
        type: "CHECK_IN",
        timestampServer: new Date(`${day(2)}T09:30:00.000Z`),
      },
      {
        ...attendanceBase,
        id: randomUUID(),
        type: "CHECK_OUT",
        timestampServer: new Date(`${day(2)}T17:30:00.000Z`),
      },
    ],
  });
  await db.overtimeRequest.create({
    data: {
      id: randomUUID(),
      tenantId: tenantA.tenantId,
      memberId: employee.memberId,
      date: new Date(`${day(5)}T00:00:00.000Z`),
      startTime: "17:00",
      endTime: "19:00",
      durationMinutes: 120,
      reason: "Menyelesaikan tutup buku bulanan bersama tim finance.",
      status: "APPROVED",
      reviewedByMemberId: tenantA.ownerMemberId,
      reviewedAt: now,
    },
  });
  await db.leaveRequest.create({
    data: {
      id: randomUUID(),
      tenantId: tenantA.tenantId,
      memberId: employee.memberId,
      leaveType: "CUTI_TAHUNAN",
      startDate: new Date(`${day(10)}T00:00:00.000Z`),
      endDate: new Date(`${day(11)}T00:00:00.000Z`),
      workingDays: 2,
      reason: "Cuti tahunan untuk urusan keluarga.",
      status: "APPROVED",
      reviewedByMemberId: tenantA.ownerMemberId,
      reviewedAt: now,
    },
  });
  await db.workPermit.create({
    data: {
      id: randomUUID(),
      tenantId: tenantA.tenantId,
      memberId: employee.memberId,
      permitType: "SAKIT",
      startDate: new Date(`${day(12)}T00:00:00.000Z`),
      endDate: new Date(`${day(12)}T00:00:00.000Z`),
      reason: "Istirahat sakit dengan surat dokter.",
      status: "APPROVED",
      reviewedByMemberId: tenantA.ownerMemberId,
      reviewedAt: now,
    },
  });

  const port = 4350 + randomInt(80);
  baseUrl = `http://127.0.0.1:${port}`;
  server = spawn(join(root, "node_modules", ".bin", "next"), ["start", "-p", String(port)], {
    cwd: join(root, "apps", "web"),
    env: {
      ...process.env,
      NODE_ENV: "production",
      S1_RATE_LIMITER: "memory",
      CLIENT_VISIT_PHOTO_DIR: photoDir,
      COMPANY_LOGO_DIR: logoDir,
      NOMINATIM_BASE_URL: `http://127.0.0.1:${geocodeServer.address().port}`,
      GEOCODING_DISABLED: "0",
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
  if (geocodeServer) {
    await new Promise((resolve) => geocodeServer.close(resolve));
  }
  if (db) await db.$disconnect();
  if (photoDir) await rm(photoDir, { recursive: true, force: true });
  if (logoDir) await rm(logoDir, { recursive: true, force: true });
});

test("C-1: client visit terjadwal, check-in/out GPS + foto, ringkasan, RBAC, isolasi tenant", async () => {
  const created = await send(
    `/api/workspaces/${tenantA.tenantId}/clients`,
    tenantA.ownerToken,
    "POST",
    {
      name: "PT Klien Nusantara",
      picName: "Rina Wijaya",
      phone: "021-555-0101",
      address: "Jl. Sudirman Kav. 10, Jakarta",
      latitude: -6.2,
      longitude: 106.816666,
      radiusMeters: 100,
    },
  );
  assert.equal(created.response.status, 201, JSON.stringify(created.body));
  clientId = created.body.id;

  const settings = await send(
    `/api/workspaces/${tenantA.tenantId}/client-visits/settings`,
    tenantA.ownerToken,
  );
  assert.equal(settings.response.status, 200);
  assert.equal(settings.body.requirePhoto, true);

  const schedule = await send(
    `/api/workspaces/${tenantA.tenantId}/client-visits`,
    tenantA.ownerToken,
    "POST",
    {
      clientId,
      memberId: employee.memberId,
      scheduledDate: now.toISOString().slice(0, 10),
      plannedStartTime: "09:00",
      plannedEndTime: "11:00",
      purpose: "Presentasi proposal dan penandatanganan kontrak.",
    },
  );
  assert.equal(schedule.response.status, 201, JSON.stringify(schedule.body));
  scheduleId = schedule.body.id;

  const dayView = await send("/api/mobile/client-visits", employee.token);
  assert.equal(dayView.response.status, 200, JSON.stringify(dayView.body));
  assert.equal(dayView.body.schedules.length, 1);
  assert.equal(dayView.body.schedules[0].id, scheduleId);

  const checkIn = await sendPhoto(
    `/api/mobile/client-visits/${scheduleId}`,
    employee.token,
    {
      type: "CHECK_IN",
      latitude: "-6.2",
      longitude: "106.816666",
      accuracy_meters: "6",
      notes: "Bertemu PIC dan memulai presentasi.",
    },
  );
  assert.equal(checkIn.response.status, 201, JSON.stringify(checkIn.body));
  assert.equal(checkIn.body.type, "CHECK_IN");
  assert.equal(checkIn.body.isInsideRadius, true);
  assert.equal(checkIn.body.address, GEOCODE_ADDRESS);
  assert.ok(checkIn.body.photoUrl);

  const proof = await fetch(`${baseUrl}${checkIn.body.photoUrl}`, {
    headers: { authorization: `Bearer ${employee.token}`, connection: "close" },
  });
  assert.equal(proof.status, 200);
  assert.equal(proof.headers.get("content-type"), "image/jpeg");
  assert.deepEqual(new Uint8Array(await proof.arrayBuffer()), JPEG);

  const foreignProof = await fetch(`${baseUrl}${checkIn.body.photoUrl}`, {
    headers: { authorization: `Bearer ${tenantB.ownerToken}`, connection: "close" },
  });
  assert.equal(foreignProof.status, 403);

  const checkOut = await sendPhoto(
    `/api/mobile/client-visits/${scheduleId}`,
    employee.token,
    {
      type: "CHECK_OUT",
      latitude: "-6.2",
      longitude: "106.816666",
      accuracy_meters: "6",
      notes: "Kontrak ditandatangani, tindak lanjut minggu depan.",
    },
  );
  assert.equal(checkOut.response.status, 201, JSON.stringify(checkOut.body));
  assert.equal(checkOut.body.type, "CHECK_OUT");
  assert.equal(checkOut.body.address, GEOCODE_ADDRESS);
  assert.ok(checkOut.body.durationMinutes >= 0);

  const summary = await send(
    `/api/workspaces/${tenantA.tenantId}/client-visits/summary`,
    tenantA.ownerToken,
  );
  assert.equal(summary.response.status, 200, JSON.stringify(summary.body));
  assert.equal(summary.body.totalSchedules, 1);
  assert.equal(summary.body.completedSchedules, 1);
  assert.equal(summary.body.perClient[0].clientName, "PT Klien Nusantara");

  const insights = await send(
    `/api/workspaces/${tenantA.tenantId}/client-visits/insights`,
    tenantA.ownerToken,
  );
  assert.equal(insights.response.status, 200);
  assert.ok(insights.body.insights.length > 0);

  const employeeLogs = await send(
    `/api/workspaces/${tenantA.tenantId}/client-visits/logs`,
    employee.token,
  );
  assert.equal(employeeLogs.response.status, 403);
  const foreignLogs = await send(
    `/api/workspaces/${tenantA.tenantId}/client-visits/logs`,
    tenantB.ownerToken,
  );
  assert.equal(foreignLogs.response.status, 403);
  const employeeSettings = await send(
    `/api/workspaces/${tenantA.tenantId}/client-visits/settings`,
    employee.token,
    "PATCH",
    { defaultRadiusMeters: 500 },
  );
  assert.equal(employeeSettings.response.status, 403);

  const audit = await db.auditLog.findFirst({
    where: { action: "client_visit.check_in", resourceId: checkIn.body.id },
  });
  assert.ok(audit);
  assert.equal(audit.tenantId, tenantA.tenantId);
});

test("C-1B: kunjungan ad-hoc GPS + nama client + foto dan export XLSX", async () => {
  const clientName = "PT Kunjungan Ad-hoc";
  const created = await sendPhoto("/api/mobile/client-visits", employee.token, {
    clientName,
    notes: "Bertemu PIC untuk membahas renewal kontrak.",
    latitude: "-6.21",
    longitude: "106.82",
    accuracy_meters: "8",
  });
  assert.equal(created.response.status, 201, JSON.stringify(created.body));
  assert.equal(created.body.scheduleId, null);
  assert.equal(created.body.clientId, null);
  assert.equal(created.body.clientName, clientName);
  assert.equal(created.body.type, "AD_HOC");
  assert.equal(created.body.address, GEOCODE_ADDRESS);
  assert.ok(created.body.photoUrl);

  const stored = await db.clientVisitLog.findUnique({ where: { id: created.body.id } });
  assert.equal(stored.scheduleId, null);
  assert.equal(stored.clientId, null);
  assert.equal(stored.clientName, clientName);
  assert.equal(stored.distanceMeters, null);
  assert.equal(stored.isInsideRadius, null);
  assert.equal(stored.address, GEOCODE_ADDRESS);
  // Data lama tanpa kolom address harus tetap mendapat alamat saat export.
  await db.clientVisitLog.update({
    where: { id: created.body.id },
    data: { address: null },
  });

  const logList = await send(
    `/api/workspaces/${tenantA.tenantId}/client-visits/logs?from=${now.toISOString().slice(0, 10)}`,
    tenantA.ownerToken,
  );
  assert.equal(logList.response.status, 200);
  assert.ok(logList.body.logs.some((row) => row.id === created.body.id && row.clientName === clientName));

  const logo = await uploadLogo(tenantA.ownerToken, PNG, "logo.png", "image/png");
  assert.equal(logo.response.status, 201, JSON.stringify(logo.body));

  const exportResponse = await fetch(
    `${baseUrl}/api/workspaces/${tenantA.tenantId}/client-visits/export.xlsx?from=${now.toISOString().slice(0, 10)}&to=${now.toISOString().slice(0, 10)}`,
    { headers: { authorization: `Bearer ${tenantA.ownerToken}`, connection: "close" } },
  );
  assert.equal(exportResponse.status, 200);
  assert.match(
    exportResponse.headers.get("content-type") ?? "",
    /application\/vnd\.openxmlformats-officedocument\.spreadsheetml\.sheet/,
  );
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(Buffer.from(await exportResponse.arrayBuffer()));
  const sheet = workbook.getWorksheet("Kunjungan Client");
  assert.ok(sheet);

  assert.ok(sheet.model.merges.includes("A1:L1"));
  assert.ok(sheet.model.merges.includes("A2:L2"));
  assert.match(
    String(sheet.getCell("A1").value),
    /^Kunjungan Klien - \d{1,2} [A-Za-z]+ - \d{1,2} [A-Za-z]+ \d{4}$/,
  );
  const workspace = await db.workspace.findUnique({ where: { id: tenantA.tenantId } });
  assert.equal(sheet.getCell("A2").value, workspace.name);
  assert.equal(sheet.getRow(1).height, 30);
  assert.equal(sheet.getRow(2).height, 24);
  assert.equal(sheet.getRow(3).height, 28);

  const headers = [
    "Nama Karyawan",
    "Jabatan",
    "Nama Klien",
    "Waktu Datang",
    "Waktu Pulang",
    "Durasi",
    "Foto Datang",
    "Foto Pulang",
    "Catatan Datang",
    "Catatan Pulang",
    "Alamat Datang",
    "Alamat Pulang",
  ];
  headers.forEach((label, index) => {
    const cell = sheet.getRow(3).getCell(index + 1);
    assert.equal(cell.value, label);
    assert.equal(cell.fill?.fgColor?.argb, "FF25A091");
    assert.equal(cell.font?.name, "Calibri");
    assert.equal(cell.font?.size, 11);
    assert.equal(cell.font?.bold, true);
    assert.equal(cell.font?.color?.argb, "FFFFFFFF");
    assert.equal(cell.alignment?.horizontal, "center");
    assert.equal(cell.alignment?.vertical, "middle");
    assert.equal(cell.alignment?.wrapText, true);
    assert.equal(cell.border?.top?.style, "thin");
    assert.equal(cell.border?.right?.style, "thin");
    assert.equal(cell.border?.bottom?.style, "thin");
    assert.equal(cell.border?.left?.style, "thin");
    assert.equal(cell.border?.top?.color?.argb, "FF000000");
  });

  const widths = [24.5, 23.7, 44, 15.6, 13, 15, 11.6, 11.4, 33.3, 14.3, 113.1, 103.3];
  widths.forEach((width, index) => {
    assert.ok(Math.abs((sheet.getColumn(index + 1).width ?? 0) - width) < 0.01);
  });

  const images = sheet.getImages().map((image) => ({
    col: Math.round(Number(image.range.tl.col)),
    row: Math.round(Number(image.range.tl.row)),
    width: Number(image.range.ext?.width),
    height: Number(image.range.ext?.height),
  }));
  const logoImage = images.find((image) => image.row === 1 && image.col === 9);
  assert.ok(logoImage, "logo perusahaan harus disematkan pada baris 2");
  assert.equal(logoImage.width, 32);
  assert.equal(logoImage.height, 32);
  assert.equal(logoImage.width, logoImage.height);

  const checkInPhoto = images.find((image) => image.col === 6 && image.row >= 3);
  assert.ok(checkInPhoto, "foto datang harus disematkan di kolom G");
  assert.equal(checkInPhoto.width, 80);
  assert.equal(checkInPhoto.height, 140);
  assert.equal(sheet.getRow(checkInPhoto.row + 1).height, 150);
  assert.ok(
    images.some((image) => image.col === 7 && image.row >= 3),
    "foto pulang harus disematkan di kolom H",
  );

  const dataRows = [];
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber >= 4) dataRows.push(row);
  });
  const scheduledRow = dataRows.find(
    (row) => row.getCell(3).value === "PT Klien Nusantara",
  );
  assert.ok(scheduledRow, "baris kunjungan terjadwal harus ada di XLSX");
  assert.equal(scheduledRow.getCell(1).value, "Member");
  assert.equal(scheduledRow.getCell(2).value, "-");
  assert.match(String(scheduledRow.getCell(4).value), /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
  assert.match(String(scheduledRow.getCell(5).value), /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
  assert.equal(scheduledRow.getCell(6).value, "0 menit");
  assert.equal(scheduledRow.getCell(7).value, "");
  assert.equal(scheduledRow.getCell(8).value, "");
  assert.equal(scheduledRow.getCell(9).value, "Bertemu PIC dan memulai presentasi.");
  assert.equal(
    scheduledRow.getCell(10).value,
    "Kontrak ditandatangani, tindak lanjut minggu depan.",
  );
  assert.equal(
    scheduledRow.getCell(11).value,
    `${GEOCODE_ADDRESS}\nhttps://www.google.com/maps?q=-6.2,106.816666`,
  );
  assert.equal(
    scheduledRow.getCell(12).value,
    `${GEOCODE_ADDRESS}\nhttps://www.google.com/maps?q=-6.2,106.816666`,
  );
  assert.equal(scheduledRow.getCell(12).alignment?.vertical, "middle");
  assert.equal(scheduledRow.getCell(12).alignment?.wrapText, true);
  assert.equal(scheduledRow.getCell(12).border?.bottom?.color?.argb, "FFD1D5DB");
  assert.equal(scheduledRow.height, 150);

  const adHocRow = dataRows.find((row) => row.getCell(3).value === clientName);
  assert.ok(adHocRow, "baris kunjungan ad-hoc harus ada di XLSX");
  assert.match(String(adHocRow.getCell(4).value), /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
  assert.equal(adHocRow.getCell(5).value, "");
  assert.equal(adHocRow.getCell(6).value, "");
  assert.equal(adHocRow.getCell(9).value, "Bertemu PIC untuk membahas renewal kontrak.");
  assert.equal(adHocRow.getCell(12).value, "");
  assert.equal(
    adHocRow.getCell(11).value,
    `${GEOCODE_ADDRESS}\nhttps://www.google.com/maps?q=-6.21,106.82`,
  );
  assert.equal(adHocRow.height, 150);

  // Logo uji membuat company profile; bersihkan agar test profil berikutnya
  // tetap dapat membuat profilnya sendiri.
  await db.companyProfile.deleteMany({ where: { tenantId: tenantA.tenantId } });

  const foreignExport = await fetch(
    `${baseUrl}/api/workspaces/${tenantA.tenantId}/client-visits/export.xlsx`,
    { headers: { authorization: `Bearer ${tenantB.ownerToken}`, connection: "close" } },
  );
  assert.equal(foreignExport.status, 403);
});

test("C-1C: admin mencatat izin dan cuti dengan audit, cuti memotong saldo", async () => {
  const patternId = randomUUID();
  await db.workPattern.create({
    data: {
      id: patternId,
      tenantId: tenantA.tenantId,
      name: "Pola Uji Admin",
      timezone: "Asia/Jakarta",
      days: {
        create: [1, 2, 3, 4, 5].map((dayOfWeek) => ({
          id: randomUUID(),
          dayOfWeek,
          isWorkday: true,
          startTime: "09:00",
          endTime: "17:00",
        })),
      },
    },
  });
  await db.workPatternAssignment.create({
    data: {
      id: randomUUID(),
      tenantId: tenantA.tenantId,
      memberId: otherEmployee.memberId,
      workPatternId: patternId,
    },
  });
  await db.workspaceHoliday.create({
    data: {
      id: randomUUID(),
      tenantId: tenantA.tenantId,
      date: new Date("2026-12-02T00:00:00.000Z"),
      name: "Libur uji cuti",
    },
  });

  const permit = await sendPhoto(
    `/api/workspaces/${tenantA.tenantId}/permits`,
    tenantA.ownerToken,
    {
      memberId: otherEmployee.memberId,
      permitType: "DINAS",
      startDate: "2026-12-08",
      endDate: "2026-12-08",
      reason: "Menghadiri rapat koordinasi dinas di luar kantor.",
      status: "APPROVED",
    },
    "proof",
  );
  assert.equal(permit.response.status, 201, JSON.stringify(permit.body));
  assert.equal(permit.body.status, "APPROVED");
  assert.equal(permit.body.memberId, otherEmployee.memberId);
  assert.equal(permit.body.hasProof, true);
  assert.ok(permit.body.proofUrl);
  assert.equal(
    await db.inAppNotification.count({
      where: { tenantId: tenantA.tenantId, memberId: otherEmployee.memberId, type: "PERMIT_APPROVED" },
    }),
    1,
  );
  assert.ok(
    await db.auditLog.findFirst({
      where: { action: "permit.admin_create", resourceId: permit.body.id, tenantId: tenantA.tenantId },
    }),
  );

  const leave = await send(
    `/api/workspaces/${tenantA.tenantId}/leave`,
    tenantA.ownerToken,
    "POST",
    {
      memberId: otherEmployee.memberId,
      leaveType: "CUTI_TAHUNAN",
      startDate: "2026-12-01",
      endDate: "2026-12-03",
      reason: "Cuti keluarga yang sudah disetujui secara langsung oleh admin.",
      status: "APPROVED",
    },
  );
  assert.equal(leave.response.status, 201, JSON.stringify(leave.body));
  assert.equal(leave.body.status, "APPROVED");
  assert.equal(leave.body.memberId, otherEmployee.memberId);
  assert.equal(leave.body.workingDays, 2);
  const balance = await db.memberLeaveBalance.findFirst({
    where: { tenantId: tenantA.tenantId, memberId: otherEmployee.memberId, year: 2026 },
  });
  assert.equal(balance?.usedDays, 2);
  assert.equal(
    await db.inAppNotification.count({
      where: { tenantId: tenantA.tenantId, memberId: otherEmployee.memberId, type: "LEAVE_APPROVED" },
    }),
    1,
  );
  assert.ok(
    await db.auditLog.findFirst({
      where: { action: "leave.admin_create", resourceId: leave.body.id, tenantId: tenantA.tenantId },
    }),
  );

  const employeeDenied = await send(
    `/api/workspaces/${tenantA.tenantId}/permits`,
    employee.token,
    "POST",
    {
      memberId: employee.memberId,
      permitType: "SAKIT",
      startDate: "2026-12-10",
      endDate: "2026-12-10",
      reason: "Percobaan input izin tanpa izin admin.",
      status: "APPROVED",
    },
  );
  assert.equal(employeeDenied.response.status, 403);
});

test("C-2: proyeksi pekerjaan, progres, kendala, review atasan, RBAC dan tenant", async () => {
  const created = await send(
    "/api/mobile/work-projections",
    employee.token,
    "POST",
    {
      title: "Rekonsiliasi data client bulanan",
      description: "Cocokkan data kunjungan dan tagihan client prioritas.",
      periodType: "WEEKLY",
      startDate: day(2),
      endDate: day(6),
    },
  );
  assert.equal(created.response.status, 201, JSON.stringify(created.body));
  assert.equal(created.body.progress, 0);
  assert.equal(created.body.status, "PLANNED");

  const updated = await send(
    `/api/mobile/work-projections/${created.body.id}`,
    employee.token,
    "PATCH",
    { progress: 65, status: "IN_PROGRESS" },
  );
  assert.equal(updated.response.status, 200, JSON.stringify(updated.body));
  assert.equal(updated.body.progress, 65);
  assert.equal(updated.body.status, "IN_PROGRESS");

  const blocked = await send(
    `/api/mobile/work-projections/${created.body.id}`,
    otherEmployee.token,
    "PATCH",
    { progress: 80, status: "BLOCKED", blockerNote: "Bukan pemilik target." },
  );
  assert.equal(blocked.response.status, 404);

  const review = await send(
    `/api/workspaces/${tenantA.tenantId}/work-projections/${created.body.id}/review`,
    tenantA.ownerToken,
    "PATCH",
    { reviewNote: "Progres baik, lanjutkan validasi dengan finance." },
  );
  assert.equal(review.response.status, 200, JSON.stringify(review.body));
  assert.equal(review.body.reviewNote, "Progres baik, lanjutkan validasi dengan finance.");

  const employeeReview = await send(
    `/api/workspaces/${tenantA.tenantId}/work-projections/${created.body.id}/review`,
    employee.token,
    "PATCH",
    { reviewNote: "Percobaan tanpa izin." },
  );
  assert.equal(employeeReview.response.status, 403);

  const workspaceList = await send(
    `/api/workspaces/${tenantA.tenantId}/work-projections`,
    tenantA.ownerToken,
  );
  assert.equal(workspaceList.response.status, 200);
  assert.ok(workspaceList.body.projections.some((row) => row.id === created.body.id));

  const foreignList = await send(
    `/api/workspaces/${tenantA.tenantId}/work-projections`,
    tenantB.ownerToken,
  );
  assert.equal(foreignList.response.status, 403);

  const audit = await db.auditLog.findFirst({
    where: { action: "work_projection.review", resourceId: created.body.id },
  });
  assert.ok(audit);
});

test("C-3: payroll otomatis menarik hadir, telat, lembur, cuti/izin, SP, lalu finalisasi & bayar", async () => {
  const settings = await send(
    `/api/workspaces/${tenantA.tenantId}/payroll/settings`,
    tenantA.ownerToken,
    "PATCH",
    {
      baseSalary: 5_000_000,
      attendanceAllowance: 300_000,
      transportAllowance: 500_000,
      mealAllowance: 300_000,
      overtimeHourlyRate: 50_000,
      lateDeductionPerMinute: 1_000,
      lateDeductionPerIncident: 5_000,
      sp1Deduction: 100_000,
      sp2Deduction: 200_000,
      sp3Deduction: 300_000,
    },
  );
  assert.equal(settings.response.status, 200, JSON.stringify(settings.body));

  const compensation = await send(
    `/api/workspaces/${tenantA.tenantId}/payroll/compensations/${employee.memberId}`,
    tenantA.ownerToken,
    "PUT",
    { baseSalary: 6_000_000, overtimeHourlyRate: 50_000 },
  );
  assert.equal(compensation.response.status, 200, JSON.stringify(compensation.body));

  const sp1 = await send(
    `/api/workspaces/${tenantA.tenantId}/warning-letters`,
    tenantA.ownerToken,
    "POST",
    {
      memberId: employee.memberId,
      level: "SP1",
      letterNumber: "SP/HR/2026/101",
      issuedAt: day(1),
      validUntil: `${YEAR + 1}-12-31`,
      violationReason: "Keterlambatan berulang tanpa konfirmasi.",
    },
  );
  assert.equal(sp1.response.status, 201, JSON.stringify(sp1.body));
  const sp2 = await send(
    `/api/workspaces/${tenantA.tenantId}/warning-letters`,
    tenantA.ownerToken,
    "POST",
    {
      memberId: employee.memberId,
      level: "SP2",
      letterNumber: "SP/HR/2026/102",
      issuedAt: day(3),
      validUntil: `${YEAR + 1}-12-31`,
      violationReason: "Tidak memenuhi target pekerjaan dua periode berturut-turut.",
    },
  );
  assert.equal(sp2.response.status, 201, JSON.stringify(sp2.body));

  const preview = await send(
    `/api/workspaces/${tenantA.tenantId}/payroll/preview?year=${YEAR}&month=${MONTH}`,
    tenantA.ownerToken,
  );
  assert.equal(preview.response.status, 200, JSON.stringify(preview.body));
  const item = preview.body.items.find((row) => row.memberId === employee.memberId);
  assert.ok(item);
  assert.equal(item.baseSalary, 6_000_000);
  assert.equal(item.overtimeMinutes, 120);
  assert.equal(item.overtimePay, 100_000);
  assert.equal(item.lateMinutes, 75);
  assert.equal(item.lateIncidents, 1);
  assert.equal(item.lateDeduction, 80_000);
  assert.equal(item.spLevel, "SP2");
  assert.equal(item.spDeduction, 200_000);
  assert.equal(item.leaveDays, 2);
  assert.equal(item.permitDays, 1);
  assert.equal(item.grossPay, item.baseSalary + item.attendanceAllowance + item.transportAllowance + item.mealAllowance + item.overtimePay);
  assert.equal(item.netPay, item.grossPay - item.totalDeductions);

  const run = await send(
    `/api/workspaces/${tenantA.tenantId}/payroll/runs`,
    tenantA.ownerToken,
    "POST",
    { year: YEAR, month: MONTH, notes: "Payroll test Tahap C" },
  );
  assert.equal(run.response.status, 201, JSON.stringify(run.body));
  assert.equal(run.body.status, "DRAFT");
  assert.equal(run.body.periodYear, YEAR);
  assert.equal(run.body.periodMonth, MONTH);
  const runItem = run.body.items.find((row) => row.memberId === employee.memberId);
  assert.equal(runItem.netPay, item.netPay);

  const employeeRuns = await send(
    `/api/workspaces/${tenantA.tenantId}/payroll/runs`,
    employee.token,
  );
  assert.equal(employeeRuns.response.status, 403);
  const foreignRuns = await send(
    `/api/workspaces/${tenantA.tenantId}/payroll/runs`,
    tenantB.ownerToken,
  );
  assert.equal(foreignRuns.response.status, 403);

  const beforeFinal = await send("/api/mobile/payslips", employee.token);
  assert.equal(beforeFinal.response.status, 200);
  assert.equal(beforeFinal.body.payslips.length, 0);

  const finalized = await send(
    `/api/workspaces/${tenantA.tenantId}/payroll/runs/${run.body.id}/finalize`,
    tenantA.ownerToken,
    "POST",
  );
  assert.equal(finalized.response.status, 200, JSON.stringify(finalized.body));
  assert.equal(finalized.body.status, "FINALIZED");

  const locked = await send(
    `/api/workspaces/${tenantA.tenantId}/payroll/runs`,
    tenantA.ownerToken,
    "POST",
    { year: YEAR, month: MONTH },
  );
  assert.equal(locked.response.status, 409);

  const afterFinal = await send("/api/mobile/payslips", employee.token);
  assert.equal(afterFinal.response.status, 200);
  assert.equal(afterFinal.body.payslips.length, 1);
  assert.equal(afterFinal.body.payslips[0].runId, run.body.id);
  assert.equal(afterFinal.body.payslips[0].item.netPay, item.netPay);

  const otherPayslips = await send("/api/mobile/payslips", otherEmployee.token);
  assert.equal(otherPayslips.body.payslips.length, 1);
  assert.equal(otherPayslips.body.payslips[0].item.memberId, otherEmployee.memberId);
  assert.notEqual(otherPayslips.body.payslips[0].item.netPay, item.netPay);

  const paid = await send(
    `/api/workspaces/${tenantA.tenantId}/payroll/runs/${run.body.id}/pay`,
    tenantA.ownerToken,
    "POST",
    { paymentReference: "TRF-2026-11-BATCH-01" },
  );
  assert.equal(paid.response.status, 200, JSON.stringify(paid.body));
  assert.equal(paid.body.status, "PAID");
  assert.equal(paid.body.paymentReference, "TRF-2026-11-BATCH-01");

  const csv = await fetch(
    `${baseUrl}/api/workspaces/${tenantA.tenantId}/payroll/runs/${run.body.id}/csv`,
    { headers: { authorization: `Bearer ${tenantA.ownerToken}`, connection: "close" } },
  );
  assert.equal(csv.status, 200);
  assert.match(csv.headers.get("content-type") ?? "", /text\/csv/);
  const text = await csv.text();
  assert.match(text, /member_name/);
  assert.match(text, /SP2/);

  const notifications = await db.inAppNotification.count({
    where: {
      tenantId: tenantA.tenantId,
      memberId: employee.memberId,
      type: { in: ["PAYROLL_FINALIZED", "PAYROLL_PAID"] },
    },
  });
  assert.equal(notifications, 2);

  const audit = await db.auditLog.findFirst({
    where: { action: "payroll.pay", resourceId: run.body.id },
  });
  assert.ok(audit);
  assert.equal(audit.tenantId, tenantA.tenantId);
});

test("C-4: profil perusahaan tersimpan dan hanya admin yang dapat mengubah", async () => {
  await db.companyProfile.create({
    data: {
      id: randomUUID(),
      tenantId: tenantA.tenantId,
      legalName: "PT Lama",
      taxNumber: "01.234.567.8-901.000",
      operatingHours: "Senin–Jumat 08.00–17.00 WIB",
    },
  });
  const initial = await send(
    `/api/workspaces/${tenantA.tenantId}/settings/company`,
    tenantA.ownerToken,
  );
  assert.equal(initial.response.status, 200);

  const updated = await send(
    `/api/workspaces/${tenantA.tenantId}/settings/company`,
    tenantA.ownerToken,
    "PATCH",
    {
      legalName: "PT Solusi Absensi Nusantara",
      address: "Jl. Gatot Subroto No. 88, Jakarta",
      contactEmail: "hr@solusiabsensi.test",
      contactPhone: "021-555-0199",
    },
  );
  assert.equal(updated.response.status, 200, JSON.stringify(updated.body));
  assert.equal(updated.body.legalName, "PT Solusi Absensi Nusantara");
  // Kolom lama tetap nullable dan tidak ikut ditimpa oleh payload baru.
  assert.equal(updated.body.taxNumber, "01.234.567.8-901.000");
  assert.equal(updated.body.operatingHours, "Senin–Jumat 08.00–17.00 WIB");

  const employeeUpdate = await send(
    `/api/workspaces/${tenantA.tenantId}/settings/company`,
    employee.token,
    "PATCH",
    { legalName: "Perubahan tanpa izin" },
  );
  assert.equal(employeeUpdate.response.status, 403);

  const foreignRead = await send(
    `/api/workspaces/${tenantA.tenantId}/settings/company`,
    tenantB.ownerToken,
  );
  assert.equal(foreignRead.response.status, 403);

  const audit = await db.auditLog.findFirst({
    where: { action: "company.profile_update", tenantId: tenantA.tenantId },
  });
  assert.ok(audit);
  assert.equal(audit.resourceType, "company_profile");
});
