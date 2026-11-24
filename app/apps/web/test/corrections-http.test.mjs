import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash, randomInt, randomUUID } from "node:crypto";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
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
const OFFICE = { latitude: -6.2, longitude: 106.8, radiusMeters: 100 };
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 7, 6, 5, 0xff, 0xd9]);

let db;
let server;
let baseUrl;
let proofDir;
let tenantA;
let tenantB;
let employeeA;
let employeeB;
let employeeC;

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

function daysAgo(days) {
  return new Date(Date.now() - days * 86_400_000);
}

async function submitJson(token, body) {
  const response = await fetch(`${baseUrl}/api/corrections`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      connection: "close",
    },
    body: JSON.stringify(body),
  });
  return { response, body: await response.json() };
}

async function submitMultipart(token, fields, file) {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, String(value));
  if (file) data.set("proof", new Blob([file.bytes], { type: file.type }), file.name);
  const response = await fetch(`${baseUrl}/api/corrections`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, connection: "close" },
    body: data,
  });
  return { response, body: await response.json() };
}

async function get(path, token) {
  const response = await fetch(`${baseUrl}${path}`, {
    headers: { authorization: `Bearer ${token}`, connection: "close" },
  });
  return { response, body: await response.json() };
}

async function review(token, id, body) {
  const response = await fetch(`${baseUrl}/api/corrections/${id}`, {
    method: "PATCH",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      connection: "close",
    },
    body: JSON.stringify(body),
  });
  return { response, body: await response.json() };
}

function validBody(overrides = {}) {
  return {
    requestType: "CHECK_IN",
    requestedTimestamp: daysAgo(2).toISOString(),
    reason: "Lupa check-in karena jaringan kantor terputus",
    ...overrides,
  };
}

async function createAttendance(memberId, tenantId, overrides = {}) {
  const id = randomUUID();
  await db.attendanceLog.create({
    data: {
      id,
      tenantId,
      memberId,
      workDate: new Date("2026-11-18T00:00:00Z"),
      type: "CHECK_IN",
      timestampServer: new Date("2026-11-18T01:00:00Z"),
      latitude: OFFICE.latitude,
      longitude: OFFICE.longitude,
      accuracyMeters: 5,
      distanceMeters: 0,
      isMockLocation: false,
      photoUrl: "/uploads/attendance/x.jpg",
      photoHash: "c".repeat(64),
      ...overrides,
    },
  });
  return id;
}

before(async () => {
  db = adminClient();
  await resetDatabase(db);
  proofDir = await mkdtemp(join(tmpdir(), "absensi-proof-"));
  tenantA = await seedTenant(db, { name: "Correction A" });
  tenantB = await seedTenant(db, { name: "Correction B" });
  employeeA = await seedMember(db, tenantA.tenantId, tenantA.roles.VIEWER);
  employeeB = await seedMember(db, tenantB.tenantId, tenantB.roles.VIEWER);
  employeeC = await seedMember(db, tenantA.tenantId, tenantA.roles.VIEWER);
  for (const [tenantId, name] of [
    [tenantA.tenantId, "Correction A HQ"],
    [tenantB.tenantId, "Correction B HQ"],
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

  // Hindari 3307 (port MariaDB dev) dan rentang ephemeral umum.
  const port = 4400 + randomInt(400);
  baseUrl = `http://127.0.0.1:${port}`;
  server = spawn(join(root, "node_modules", ".bin", "next"), ["start", "-p", String(port)], {
    cwd: join(root, "apps", "web"),
    env: {
      ...process.env,
      NODE_ENV: "production",
      S1_RATE_LIMITER: "memory",
      // Test fungsional memakai batas lebih longgar; default 1 diuji terpisah.
      REVISION_MONTHLY_LIMIT: "3",
      ATTENDANCE_PROOF_DIR: proofDir,
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
  if (proofDir) await rm(proofDir, { recursive: true, force: true });
});

test("C-HTTP-1: pengajuan valid + bukti → 201 PENDING, file + hash, audit aman", async () => {
  const submitted = await submitMultipart(
    employeeA.token,
    validBody({ reason: "Lupa check-in karena jaringan kantor terputus" }),
    { bytes: JPEG, type: "image/jpeg", name: "bukti.jpg" },
  );
  assert.equal(submitted.response.status, 201);
  assert.equal(submitted.body.status, "PENDING");
  assert.equal(submitted.body.requestType, "CHECK_IN");
  assert.match(submitted.body.proofUrl, /^\/uploads\/proofs\/[0-9a-f-]+\.jpg$/);
  assert.equal("proofHash" in submitted.body, false);

  const row = await db.correctionRequest.findUniqueOrThrow({
    where: { id: submitted.body.id },
  });
  assert.equal(row.tenantId, tenantA.tenantId);
  assert.equal(row.memberId, employeeA.memberId);
  assert.equal(row.proofHash, createHash("sha256").update(JPEG).digest("hex"));
  const files = await readdir(proofDir);
  assert.deepEqual(new Uint8Array(await readFile(join(proofDir, files[0]))), JPEG);

  const audit = await db.auditLog.findFirstOrThrow({
    where: { action: "correction.request", resourceId: submitted.body.id },
  });
  assert.equal(audit.tenantId, tenantA.tenantId);
  assert.equal(audit.actorUserId, employeeA.userId);
  assert.equal(audit.actorMemberId, employeeA.memberId);
  assert.equal(audit.ipHash?.length, 32);
  assert.deepEqual(Object.keys(audit.metadata).sort(), [
    "hasProof",
    "requestType",
    "requestedTimestamp",
  ]);
  assert.equal(audit.metadata.hasProof, true);
  const serialized = JSON.stringify(audit.metadata);
  assert.equal(serialized.includes("jaringan kantor"), false);
  assert.equal(serialized.includes(row.proofHash), false);
  assert.equal(serialized.includes("/uploads/proofs/"), false);

  const withoutProof = await submitJson(
    employeeA.token,
    validBody({ reason: "Lupa check-out karena rapat panjang" }),
  );
  assert.equal(withoutProof.response.status, 201);
  assert.equal(withoutProof.body.status, "PENDING");
  assert.equal(withoutProof.body.proofUrl, null);
  const auditWithout = await db.auditLog.findFirstOrThrow({
    where: { action: "correction.request", resourceId: withoutProof.body.id },
  });
  assert.equal(auditWithout.metadata.hasProof, false);
});

test("C-HTTP-2: window 7 hari, masa depan, dan alasan pendek ditolak", async () => {
  const window = await submitJson(
    employeeA.token,
    validBody({ requestedTimestamp: daysAgo(8).toISOString() }),
  );
  assert.equal(window.response.status, 400);
  assert.equal(window.body.error.code, "WINDOW_EXCEEDED");

  const future = await submitJson(
    employeeA.token,
    validBody({ requestedTimestamp: new Date(Date.now() + 3_600_000).toISOString() }),
  );
  assert.equal(future.response.status, 400);
  assert.equal(future.body.error.code, "FUTURE_TIMESTAMP");

  const short = await submitJson(employeeA.token, validBody({ reason: "pendek" }));
  assert.equal(short.response.status, 400);
  assert.equal(short.body.error.code, "ALASAN_TOO_SHORT");

  assert.equal(
    await db.correctionRequest.count({
      where: { memberId: employeeA.memberId, reason: "pendek" },
    }),
    0,
  );
});

test("C-HTTP-3: attendanceLogId milik member lain → 403", async () => {
  const foreignLog = await createAttendance(employeeB.memberId, tenantB.tenantId);
  const result = await submitJson(
    employeeA.token,
    validBody({ attendanceLogId: foreignLog }),
  );
  assert.equal(result.response.status, 403);
  assert.equal(result.body.error.code, "ATTENDANCE_LOG_FORBIDDEN");
  assert.equal(
    await db.correctionRequest.count({ where: { attendanceLogId: foreignLog } }),
    0,
  );
});

test("C-HTTP-4: batas 3 pengajuan per bulan → 429", async () => {
  const limited = await seedMember(db, tenantA.tenantId, tenantA.roles.VIEWER);
  for (let index = 0; index < 3; index += 1) {
    const result = await submitJson(
      limited.token,
      validBody({ reason: `Pengajuan revisi wajar nomor ${index + 1}` }),
    );
    assert.equal(result.response.status, 201);
  }
  const fourth = await submitJson(
    limited.token,
    validBody({ reason: "Pengajuan revisi keempat ditolak" }),
  );
  assert.equal(fourth.response.status, 429);
  assert.equal(fourth.body.error.code, "REVISION_LIMIT_EXCEEDED");
  assert.ok(fourth.response.headers.get("retry-after"));
});

test("C-HTTP-5: karyawan hanya melihat revisi sendiri dan bisa filter status", async () => {
  const foreign = await submitJson(
    employeeB.token,
    validBody({
      reason: "Revisi milik karyawan tenant B",
      requestedTimestamp: daysAgo(4).toISOString(),
    }),
  );
  assert.equal(foreign.response.status, 201);

  const mine = await get("/api/corrections/me", employeeA.token);
  assert.equal(mine.response.status, 200);
  assert.ok(mine.body.corrections.length >= 2);
  assert.equal(
    mine.body.corrections.every((row) => row.memberId === employeeA.memberId),
    true,
  );
  assert.equal(
    mine.body.corrections.some((row) => row.id === foreign.body.id),
    false,
  );

  const target = mine.body.corrections[0];
  await db.correctionRequest.update({
    where: { id: target.id },
    data: { status: "APPROVED" },
  });
  const approved = await get("/api/corrections/me?status=APPROVED", employeeA.token);
  assert.equal(approved.response.status, 200);
  assert.deepEqual(approved.body.corrections.map((row) => row.id), [target.id]);

  const rejected = await get("/api/corrections/me?status=REJECTED", employeeA.token);
  assert.equal(rejected.body.corrections.length, 0);

  const invalid = await get("/api/corrections/me?status=LOL", employeeA.token);
  assert.equal(invalid.response.status, 400);
  assert.equal(invalid.body.error.code, "INVALID_STATUS");

  const other = await get("/api/corrections/me", employeeB.token);
  assert.deepEqual(other.body.corrections.map((row) => row.id), [foreign.body.id]);
});

test("C-HTTP-6: antrian admin tenant-scoped, filter, dan cross-tenant 403 identik", async () => {
  const queue = await get(
    `/api/workspaces/${tenantA.tenantId}/corrections`,
    tenantA.ownerToken,
  );
  assert.equal(queue.response.status, 200);
  assert.ok(queue.body.corrections.length >= 2);
  assert.equal(
    queue.body.corrections.every((row) => row.memberId !== employeeB.memberId),
    true,
  );
  assert.equal(queue.body.corrections.every((row) => row.member.name.length > 0), true);
  assert.equal(typeof queue.body.pagination.total, "number");

  const pending = await get(
    `/api/workspaces/${tenantA.tenantId}/corrections?status=PENDING`,
    tenantA.ownerToken,
  );
  assert.equal(pending.response.status, 200);
  assert.equal(pending.body.corrections.every((row) => row.status === "PENDING"), true);

  const byMember = await get(
    `/api/workspaces/${tenantA.tenantId}/corrections?memberId=${employeeA.memberId}`,
    tenantA.ownerToken,
  );
  assert.equal(byMember.response.status, 200);
  assert.equal(
    byMember.body.corrections.every((row) => row.memberId === employeeA.memberId),
    true,
  );

  const foreign = await get(
    `/api/workspaces/${tenantB.tenantId}/corrections`,
    tenantA.ownerToken,
  );
  const missing = await get(
    "/api/workspaces/00000000-0000-4000-8000-000000000000/corrections",
    tenantA.ownerToken,
  );
  assert.equal(foreign.response.status, 403);
  assert.equal(missing.response.status, 403);
  assert.deepEqual(foreign.body, missing.body);

  const ownB = await get(
    `/api/workspaces/${tenantB.tenantId}/corrections`,
    tenantB.ownerToken,
  );
  assert.equal(ownB.response.status, 200);
  assert.equal(
    ownB.body.corrections.every((row) => row.memberId === employeeB.memberId),
    true,
  );

  const nonAdmin = await get(
    `/api/workspaces/${tenantA.tenantId}/corrections`,
    employeeA.token,
  );
  assert.equal(nonAdmin.response.status, 403);
  assert.equal(nonAdmin.body.error.code, "FORBIDDEN");
});

test("C-HTTP-7: approve memperbarui log lama + audit {from, to}", async () => {
  const logId = await createAttendance(employeeA.memberId, tenantA.tenantId, {
    workDate: new Date("2026-11-17T00:00:00Z"),
    timestampServer: new Date("2026-11-17T01:00:00Z"),
  });
  const submitted = await submitJson(
    employeeA.token,
    validBody({
      attendanceLogId: logId,
      requestedTimestamp: "2026-11-17T02:30:00.000Z",
      reason: "Check-in tercatat terlalu pagi karena jam server",
    }),
  );
  assert.equal(submitted.response.status, 201);
  assert.equal(submitted.body.originalTimestamp, "2026-11-17T01:00:00.000Z");

  const approved = await review(tenantA.ownerToken, submitted.body.id, {
    action: "approve",
  });
  assert.equal(approved.response.status, 200);
  assert.equal(approved.body.status, "APPROVED");
  assert.equal(approved.body.reviewedByMemberId, tenantA.ownerMemberId);
  assert.ok(approved.body.reviewedAt);

  const updated = await db.attendanceLog.findUniqueOrThrow({ where: { id: logId } });
  assert.equal(updated.timestampServer.toISOString(), "2026-11-17T02:30:00.000Z");
  assert.equal(updated.workDate.toISOString(), "2026-11-17T00:00:00.000Z");

  const audit = await db.auditLog.findFirstOrThrow({
    where: { action: "correction.approve", resourceId: submitted.body.id },
  });
  assert.equal(audit.tenantId, tenantA.tenantId);
  assert.equal(audit.actorMemberId, tenantA.ownerMemberId);
  assert.deepEqual(Object.keys(audit.metadata).sort(), [
    "attendanceLogId",
    "from",
    "to",
  ]);
  assert.equal(audit.metadata.from, "2026-11-17T01:00:00.000Z");
  assert.equal(audit.metadata.to, "2026-11-17T02:30:00.000Z");
  assert.equal(audit.metadata.attendanceLogId, logId);
});

test("C-HTTP-8: approve tanpa log membuat log koreksi milik karyawan", async () => {
  const mine = await get("/api/corrections/me?status=PENDING", employeeA.token);
  const pending = mine.body.corrections.find((row) => row.attendanceLogId === null);
  assert.ok(pending);

  const approved = await review(tenantA.ownerToken, pending.id, { action: "approve" });
  assert.equal(approved.response.status, 200);
  assert.equal(approved.body.status, "APPROVED");

  const audit = await db.auditLog.findFirstOrThrow({
    where: { action: "correction.approve", resourceId: pending.id },
  });
  assert.equal(audit.metadata.from, null);
  assert.equal(audit.metadata.to, pending.requestedTimestamp);

  const log = await db.attendanceLog.findUniqueOrThrow({
    where: { id: audit.metadata.attendanceLogId },
  });
  assert.equal(log.memberId, employeeA.memberId);
  assert.equal(log.tenantId, tenantA.tenantId);
  assert.equal(log.isCorrection, true);
  assert.equal(log.type, pending.requestType);
  assert.equal(log.timestampServer.toISOString(), pending.requestedTimestamp);
  assert.equal(log.photoUrl, "");
  assert.equal(log.photoHash, "");

  const again = await review(tenantA.ownerToken, pending.id, { action: "approve" });
  assert.equal(again.response.status, 409);
  assert.equal(again.body.error.code, "ALREADY_REVIEWED");
});

test("C-HTTP-9: reject wajib alasan dan audit tidak memuat isi alasan", async () => {
  const other = await get("/api/corrections/me?status=PENDING", employeeB.token);
  const pending = other.body.corrections[0];
  assert.ok(pending);

  const missing = await review(tenantB.ownerToken, pending.id, { action: "reject" });
  assert.equal(missing.response.status, 400);
  assert.equal(missing.body.error.code, "REJECTION_REASON_REQUIRED");

  const short = await review(tenantB.ownerToken, pending.id, {
    action: "reject",
    rejectionReason: "tidak",
  });
  assert.equal(short.response.status, 400);
  assert.equal(short.body.error.code, "REJECTION_REASON_TOO_SHORT");

  const reason = "Bukti tidak sesuai dengan tanggal absensi";
  const rejected = await review(tenantB.ownerToken, pending.id, {
    action: "reject",
    rejectionReason: reason,
  });
  assert.equal(rejected.response.status, 200);
  assert.equal(rejected.body.status, "REJECTED");
  assert.equal(rejected.body.rejectionReason, reason);
  assert.equal(rejected.body.reviewedByMemberId, tenantB.ownerMemberId);

  const audit = await db.auditLog.findFirstOrThrow({
    where: { action: "correction.reject", resourceId: pending.id },
  });
  assert.deepEqual(Object.keys(audit.metadata).sort(), ["hasReason", "reason_length"]);
  assert.equal(audit.metadata.reason_length, reason.length);
  assert.equal(audit.metadata.hasReason, true);
  assert.equal(JSON.stringify(audit.metadata).includes(reason), false);

  const invalidAction = await review(tenantA.ownerToken, pending.id, { action: "hapus" });
  assert.equal(invalidAction.response.status, 400);
  assert.equal(invalidAction.body.error.code, "INVALID_ACTION");
});

test("C-HTTP-10: review non-admin 403 dan cross-tenant 403 identik", async () => {
  const submitted = await submitJson(
    employeeB.token,
    validBody({
      reason: "Revisi baru untuk uji otorisasi review",
      requestedTimestamp: daysAgo(3).toISOString(),
    }),
  );
  assert.equal(submitted.response.status, 201);
  const pending = submitted.body;

  const nonAdmin = await review(employeeA.token, pending.id, { action: "approve" });
  assert.equal(nonAdmin.response.status, 403);
  assert.equal(nonAdmin.body.error.code, "FORBIDDEN");

  const foreign = await review(tenantA.ownerToken, pending.id, { action: "approve" });
  const missing = await review(
    tenantA.ownerToken,
    "00000000-0000-4000-8000-000000000000",
    { action: "approve" },
  );
  assert.equal(foreign.response.status, 403);
  assert.equal(missing.response.status, 403);
  assert.equal(foreign.body.error.code, "CORRECTION_FORBIDDEN");
  assert.deepEqual(foreign.body, missing.body);

  const stillPending = await db.correctionRequest.findUniqueOrThrow({
    where: { id: pending.id },
  });
  assert.equal(stillPending.status, "PENDING");
});

test("C-HTTP-11: koreksi massal atomik, audit per perubahan, notifikasi, dan rollback", async () => {
  async function bulk(token, body) {
    const response = await fetch(`${baseUrl}/api/workspaces/${tenantA.tenantId}/corrections/bulk`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        connection: "close",
      },
      body: JSON.stringify(body),
    });
    return { response, body: await response.json() };
  }

  const payload = {
    memberIds: [employeeA.memberId, employeeC.memberId],
    date: "2026-12-10",
    type: "CHECK_IN",
    timestamp: "2026-12-10T02:30:00.000Z",
    reason: "Gangguan jaringan kantor cabang pada pagi hari",
  };
  const created = await bulk(tenantA.ownerToken, payload);
  assert.equal(created.response.status, 200);
  assert.equal(created.body.updated, 2);
  assert.equal(created.body.changes.length, 2);
  assert.equal(created.body.changes.every((row) => row.from === null), true);

  for (const memberId of [employeeA.memberId, employeeC.memberId]) {
    const log = await db.attendanceLog.findFirstOrThrow({
      where: {
        tenantId: tenantA.tenantId,
        memberId,
        workDate: new Date("2026-12-10T00:00:00.000Z"),
        type: "CHECK_IN",
      },
    });
    assert.equal(log.isCorrection, true);
    assert.equal(log.timestampServer.toISOString(), "2026-12-10T02:30:00.000Z");
    assert.equal(
      await db.inAppNotification.count({
        where: { memberId, type: "ATTENDANCE_BULK_CORRECTED" },
      }),
      1,
    );
  }
  const createdAudits = await db.auditLog.findMany({
    where: { action: "correction.bulk" },
  });
  const batchAudits = createdAudits.filter(
    (row) => row.metadata.batch_id === created.body.batchId,
  );
  assert.equal(batchAudits.length, 2);
  assert.equal(batchAudits.every((row) => row.metadata.from === null), true);
  assert.equal(batchAudits.every((row) => row.metadata.to === payload.timestamp), true);
  assert.equal(batchAudits.every((row) => row.actorMemberId === tenantA.ownerMemberId), true);

  const updated = await bulk(tenantA.ownerToken, {
    ...payload,
    timestamp: "2026-12-10T03:00:00.000Z",
  });
  assert.equal(updated.response.status, 200);
  assert.equal(updated.body.changes.every((row) => row.from === "2026-12-10T02:30:00.000Z"), true);
  const updatedLog = await db.attendanceLog.findFirstOrThrow({
    where: { tenantId: tenantA.tenantId, memberId: employeeA.memberId, type: "CHECK_IN", workDate: new Date("2026-12-10T00:00:00.000Z") },
  });
  assert.equal(updatedLog.timestampServer.toISOString(), "2026-12-10T03:00:00.000Z");

  const rollbackDate = new Date("2026-12-11T00:00:00.000Z");
  const beforeLogs = await db.attendanceLog.count({
    where: { tenantId: tenantA.tenantId, workDate: rollbackDate },
  });
  const beforeNotes = await db.inAppNotification.count({
    where: { tenantId: tenantA.tenantId, type: "ATTENDANCE_BULK_CORRECTED" },
  });
  const beforeAudits = await db.auditLog.count({ where: { action: "correction.bulk" } });
  const invalidMember = await bulk(tenantA.ownerToken, {
    ...payload,
    date: "2026-12-11",
    memberIds: [employeeA.memberId, randomUUID()],
  });
  assert.equal(invalidMember.response.status, 400);
  assert.equal(invalidMember.body.error.code, "MEMBER_NOT_FOUND");
  assert.equal(
    await db.attendanceLog.count({ where: { tenantId: tenantA.tenantId, workDate: rollbackDate } }),
    beforeLogs,
  );
  assert.equal(
    await db.inAppNotification.count({
      where: { tenantId: tenantA.tenantId, type: "ATTENDANCE_BULK_CORRECTED" },
    }),
    beforeNotes,
  );
  assert.equal(await db.auditLog.count({ where: { action: "correction.bulk" } }), beforeAudits);

  const duplicate = await bulk(tenantA.ownerToken, {
    ...payload,
    memberIds: [employeeA.memberId, employeeA.memberId],
  });
  assert.equal(duplicate.response.status, 400);
  assert.equal(duplicate.body.error.code, "DUPLICATE_MEMBER");

  const shortReason = await bulk(tenantA.ownerToken, { ...payload, reason: "pendek" });
  assert.equal(shortReason.response.status, 400);
  assert.equal(shortReason.body.error.code, "ALASAN_TOO_SHORT");

  const nonAdmin = await bulk(employeeA.token, payload);
  assert.equal(nonAdmin.response.status, 403);
  assert.equal(nonAdmin.body.error.code, "FORBIDDEN");

  const foreign = await bulk(tenantB.ownerToken, payload);
  assert.equal(foreign.response.status, 403);
});
