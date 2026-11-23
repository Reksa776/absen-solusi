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
  seedHolidays,
  seedMember,
  seedTenant,
} from "../../../packages/auth/dist/test-support.js";

const root = new URL("../../../", import.meta.url).pathname;
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 9, 8, 7, 0xff, 0xd9]);

let db;
let server;
let baseUrl;
let proofDir;
let tenantA;
let tenantB;
let employee;
let otherEmployee;

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

async function submitPermit(fields) {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) form.set(key, value);
  form.set("proof", new Blob([JPEG], { type: "image/jpeg" }), "surat-dokter.jpg");
  const response = await fetch(`${baseUrl}/api/permits`, {
    method: "POST",
    headers: { authorization: `Bearer ${employee.token}`, connection: "close" },
    body: form,
  });
  return { response, body: await response.json().catch(() => ({})) };
}

before(async () => {
  db = adminClient();
  await resetDatabase(db);
  tenantA = await seedTenant(db, { name: "Phase B A" });
  tenantB = await seedTenant(db, { name: "Phase B B" });
  employee = await seedMember(db, tenantA.tenantId, tenantA.roles.EMPLOYEE);
  otherEmployee = await seedMember(db, tenantA.tenantId, tenantA.roles.EMPLOYEE);
  proofDir = await mkdtemp(join(tmpdir(), "absensi-phase-b-proof-"));

  const port = 3900 + randomInt(80);
  baseUrl = `http://127.0.0.1:${port}`;
  server = spawn(join(root, "node_modules", ".bin", "next"), ["start", "-p", String(port)], {
    cwd: join(root, "apps", "web"),
    env: {
      ...process.env,
      NODE_ENV: "production",
      S1_RATE_LIMITER: "memory",
      PERMIT_PROOF_DIR: proofDir,
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
  if (proofDir) await rm(proofDir, { recursive: true, force: true });
});

test("B-1: izin kerja dengan bukti, approval, proof privat, RBAC, dan audit", async () => {
  const submitted = await submitPermit({
    permitType: "SAKIT",
    startDate: "2026-12-10",
    endDate: "2026-12-11",
    reason: "Demam tinggi dan memerlukan istirahat sesuai surat dokter",
  });
  assert.equal(submitted.response.status, 201, JSON.stringify(submitted.body));
  assert.equal(submitted.body.status, "PENDING");
  assert.equal(submitted.body.hasProof, true);
  assert.match(submitted.body.proofUrl, new RegExp(`/api/permits/${submitted.body.id}/proof$`));

  const proof = await fetch(`${baseUrl}${submitted.body.proofUrl}`, {
    headers: { authorization: `Bearer ${employee.token}`, connection: "close" },
  });
  assert.equal(proof.status, 200);
  assert.equal(proof.headers.get("content-type"), "image/jpeg");
  assert.deepEqual(new Uint8Array(await proof.arrayBuffer()), JPEG);

  const otherProof = await fetch(`${baseUrl}${submitted.body.proofUrl}`, {
    headers: { authorization: `Bearer ${otherEmployee.token}`, connection: "close" },
  });
  assert.equal(otherProof.status, 403);

  const mine = await send("/api/permits/me", employee.token);
  assert.equal(mine.response.status, 200);
  assert.equal(mine.body.permits.length, 1);
  assert.equal(mine.body.permits[0].memberId, employee.memberId);

  const queue = await send(
    `/api/workspaces/${tenantA.tenantId}/permits?status=PENDING`,
    tenantA.ownerToken,
  );
  assert.equal(queue.response.status, 200);
  assert.equal(queue.body.permits.length, 1);

  const employeeAdmin = await send(
    `/api/workspaces/${tenantA.tenantId}/permits`,
    employee.token,
  );
  assert.equal(employeeAdmin.response.status, 403);

  const foreignQueue = await send(
    `/api/workspaces/${tenantA.tenantId}/permits`,
    tenantB.ownerToken,
  );
  assert.equal(foreignQueue.response.status, 403);

  const foreignProof = await fetch(`${baseUrl}${submitted.body.proofUrl}`, {
    headers: { authorization: `Bearer ${tenantB.ownerToken}`, connection: "close" },
  });
  assert.equal(foreignProof.status, 403);

  const employeeReview = await send(
    `/api/permits/${submitted.body.id}`,
    employee.token,
    "PATCH",
    { action: "APPROVE" },
  );
  assert.equal(employeeReview.response.status, 403);

  const approved = await send(
    `/api/permits/${submitted.body.id}`,
    tenantA.ownerToken,
    "PATCH",
    { action: "APPROVE" },
  );
  assert.equal(approved.response.status, 200, JSON.stringify(approved.body));
  assert.equal(approved.body.status, "APPROVED");

  const audit = await db.auditLog.findFirstOrThrow({
    where: { action: "permit.approve", resourceId: submitted.body.id },
  });
  assert.equal(audit.tenantId, tenantA.tenantId);

  const notification = await db.inAppNotification.findFirst({
    where: {
      tenantId: tenantA.tenantId,
      memberId: employee.memberId,
      type: "PERMIT_APPROVED",
    },
  });
  assert.ok(notification);
});

test("B-2: cuti menghitung hari kerja, menyetujui berjenjang, dan memotong saldo", async () => {
  const policy = await send(
    `/api/workspaces/${tenantA.tenantId}/leave/settings`,
    tenantA.ownerToken,
    "PATCH",
    { annualQuotaDays: 12 },
  );
  assert.equal(policy.response.status, 200, JSON.stringify(policy.body));
  assert.equal(policy.body.annualQuotaDays, 12);

  const initialized = await send(
    `/api/workspaces/${tenantA.tenantId}/leave/balances/initialize`,
    tenantA.ownerToken,
    "POST",
    { year: 2026 },
  );
  assert.equal(initialized.response.status, 200, JSON.stringify(initialized.body));
  assert.ok(initialized.body.created >= 2);

  const initialBalance = await send("/api/leave/balance?year=2026", employee.token);
  assert.equal(initialBalance.response.status, 200);
  assert.deepEqual(
    {
      entitledDays: initialBalance.body.entitledDays,
      usedDays: initialBalance.body.usedDays,
      remainingDays: initialBalance.body.remainingDays,
    },
    { entitledDays: 12, usedDays: 0, remainingDays: 12 },
  );

  await seedHolidays(db, tenantA.tenantId, [
    { date: "2026-12-25", name: "Hari Raya Natal" },
  ]);

  const submitted = await send("/api/leave", employee.token, "POST", {
    leaveType: "CUTI_TAHUNAN",
    startDate: "2026-12-21",
    endDate: "2026-12-25",
    reason: "Liburan keluarga akhir tahun bersama orang tua",
  });
  assert.equal(submitted.response.status, 201, JSON.stringify(submitted.body));
  assert.equal(submitted.body.workingDays, 4);
  assert.equal(submitted.body.status, "PENDING");

  const beforeApproval = await send("/api/leave/balance?year=2026", employee.token);
  assert.equal(beforeApproval.body.usedDays, 0);

  const duplicate = await send("/api/leave", employee.token, "POST", {
    leaveType: "CUTI_KHUSUS",
    startDate: "2026-12-24",
    endDate: "2026-12-24",
    reason: "Pengajuan yang beririsan dengan cuti tahunan",
  });
  assert.equal(duplicate.response.status, 409);

  const queue = await send(
    `/api/workspaces/${tenantA.tenantId}/leave?status=PENDING`,
    tenantA.ownerToken,
  );
  assert.equal(queue.response.status, 200);
  assert.equal(queue.body.leave.length, 1);

  assert.equal(
    (await send(`/api/workspaces/${tenantA.tenantId}/leave`, employee.token)).response
      .status,
    403,
  );
  assert.equal(
    (
      await send(
        `/api/workspaces/${tenantA.tenantId}/leave`,
        tenantB.ownerToken,
      )
    ).response.status,
    403,
  );

  const approved = await send(
    `/api/leave/${submitted.body.id}`,
    tenantA.ownerToken,
    "PATCH",
    { action: "APPROVE" },
  );
  assert.equal(approved.response.status, 200, JSON.stringify(approved.body));
  assert.equal(approved.body.status, "APPROVED");

  const afterApproval = await send("/api/leave/balance?year=2026", employee.token);
  assert.equal(afterApproval.body.usedDays, 4);
  assert.equal(afterApproval.body.remainingDays, 8);

  const balance = await db.memberLeaveBalance.findFirstOrThrow({
    where: {
      tenantId: tenantA.tenantId,
      memberId: employee.memberId,
      year: 2026,
    },
  });
  assert.equal(balance.usedDays, 4);

  const report = await send(
    `/api/workspaces/${tenantA.tenantId}/leave/report?year=2026`,
    tenantA.ownerToken,
  );
  assert.equal(report.response.status, 200);
  const row = report.body.rows.find((item) => item.memberId === employee.memberId);
  assert.equal(row.usedDays, 4);
  assert.equal(row.remainingDays, 8);
  assert.equal(
    (
      await send(
        `/api/workspaces/${tenantA.tenantId}/leave/report?year=2026`,
        employee.token,
      )
    ).response.status,
    403,
  );

  const audit = await db.auditLog.findFirstOrThrow({
    where: { action: "leave.approve", resourceId: submitted.body.id },
  });
  assert.equal(audit.tenantId, tenantA.tenantId);

  const foreignApprove = await send(
    `/api/leave/${submitted.body.id}`,
    tenantB.ownerToken,
    "PATCH",
    { action: "REJECT", rejectionReason: "Bukan kewenangan tenant ini" },
  );
  assert.ok([403, 404].includes(foreignApprove.response.status));
});

test("B-3: SP unik, karyawan mengonfirmasi baca, RBAC dan isolasi tenant", async () => {
  const created = await send(
    `/api/workspaces/${tenantA.tenantId}/warning-letters`,
    tenantA.ownerToken,
    "POST",
    {
      memberId: employee.memberId,
      level: "SP1",
      letterNumber: "SP/HR/2026/001",
      issuedAt: "2026-11-01",
      validUntil: "2027-05-01",
      violationReason:
        "Tidak melakukan check-in selama tiga hari kerja tanpa keterangan.",
    },
  );
  assert.equal(created.response.status, 201, JSON.stringify(created.body));
  assert.equal(created.body.level, "SP1");
  assert.equal(created.body.acknowledgedAt, null);

  const duplicate = await send(
    `/api/workspaces/${tenantA.tenantId}/warning-letters`,
    tenantA.ownerToken,
    "POST",
    {
      memberId: otherEmployee.memberId,
      level: "SP2",
      letterNumber: "SP/HR/2026/001",
      issuedAt: "2026-11-02",
      validUntil: "2027-05-02",
      violationReason: "Nomor surat yang sama tidak boleh dipakai ulang.",
    },
  );
  assert.equal(duplicate.response.status, 409);

  const mine = await send("/api/warning-letters/me", employee.token);
  assert.equal(mine.response.status, 200);
  assert.equal(mine.body.letters.length, 1);
  assert.equal(mine.body.letters[0].id, created.body.id);

  const otherMine = await send("/api/warning-letters/me", otherEmployee.token);
  assert.equal(otherMine.body.letters.length, 0);

  const ack = await send(
    `/api/warning-letters/${created.body.id}/acknowledge`,
    employee.token,
    "PATCH",
  );
  assert.equal(ack.response.status, 200, JSON.stringify(ack.body));
  assert.ok(ack.body.acknowledgedAt);

  const otherAck = await send(
    `/api/warning-letters/${created.body.id}/acknowledge`,
    otherEmployee.token,
    "PATCH",
  );
  assert.equal(otherAck.response.status, 404);

  assert.equal(
    (
      await send(
        `/api/workspaces/${tenantA.tenantId}/warning-letters`,
        employee.token,
      )
    ).response.status,
    403,
  );
  assert.equal(
    (
      await send(
        `/api/workspaces/${tenantA.tenantId}/warning-letters`,
        tenantB.ownerToken,
      )
    ).response.status,
    403,
  );
  assert.equal(
    (
      await send(
        `/api/workspaces/${tenantA.tenantId}/warning-letters`,
        employee.token,
        "POST",
        {
          memberId: otherEmployee.memberId,
          level: "SP1",
          letterNumber: "SP/HR/2026/002",
          issuedAt: "2026-11-03",
          validUntil: "2027-05-03",
          violationReason: "Percobaan oleh aktor tanpa izin kelola member.",
        },
      )
    ).response.status,
    403,
  );

  const auditIssue = await db.auditLog.findFirstOrThrow({
    where: { action: "warning.issue", resourceId: created.body.id },
  });
  assert.equal(auditIssue.tenantId, tenantA.tenantId);
  const auditAck = await db.auditLog.findFirstOrThrow({
    where: { action: "warning.acknowledge", resourceId: created.body.id },
  });
  assert.equal(auditAck.tenantId, tenantA.tenantId);
});

test("B-4: broadcast draf, publikasi, prioritas, audiens divisi, dan RBAC", async () => {
  const draft = await send(
    `/api/workspaces/${tenantA.tenantId}/broadcasts`,
    tenantA.ownerToken,
    "POST",
    {
      title: "Perubahan jam operasional kantor",
      content: "Mulai pekan depan kantor tutup pukul 17.00 WIB.",
      audienceType: "ALL",
      priority: "NORMAL",
      publishNow: false,
    },
  );
  assert.equal(draft.response.status, 201, JSON.stringify(draft.body));
  assert.equal(draft.body.publishedAt, null);

  const beforePublish = await send("/api/broadcasts/me", employee.token);
  assert.equal(beforePublish.response.status, 200);
  assert.equal(beforePublish.body.broadcasts.length, 0);

  const published = await send(
    `/api/workspaces/${tenantA.tenantId}/broadcasts/${draft.body.id}/publish`,
    tenantA.ownerToken,
    "POST",
  );
  assert.equal(published.response.status, 200, JSON.stringify(published.body));
  assert.ok(published.body.publishedAt);

  const afterPublish = await send("/api/broadcasts/me", employee.token);
  assert.equal(afterPublish.body.broadcasts.length, 1);
  assert.equal(afterPublish.body.broadcasts[0].id, draft.body.id);

  const important = await send(
    `/api/workspaces/${tenantA.tenantId}/broadcasts`,
    tenantA.ownerToken,
    "POST",
    {
      title: "Pemeliharaan sistem absensi",
      content: "Sistem absensi tidak dapat diakses Sabtu pukul 22.00–23.00 WIB.",
      audienceType: "ALL",
      priority: "PENTING",
      publishNow: true,
    },
  );
  assert.equal(important.response.status, 201, JSON.stringify(important.body));

  const prioritized = await send("/api/broadcasts/me", employee.token);
  assert.equal(prioritized.body.broadcasts[0].id, important.body.id);
  assert.equal(prioritized.body.broadcasts[0].priority, "PENTING");

  const divisionId = randomUUID();
  await db.division.create({
    data: {
      id: divisionId,
      tenantId: tenantA.tenantId,
      name: "Operasional",
    },
  });
  await db.workspaceMember.update({
    where: { tenantId_id: { tenantId: tenantA.tenantId, id: employee.memberId } },
    data: { divisionId },
  });
  const targeted = await send(
    `/api/workspaces/${tenantA.tenantId}/broadcasts`,
    tenantA.ownerToken,
    "POST",
    {
      title: "Briefing tim operasional",
      content: "Briefing mingguan tim operasional digeser ke hari Kamis.",
      audienceType: "DIVISION",
      divisionId,
      priority: "NORMAL",
      publishNow: true,
    },
  );
  assert.equal(targeted.response.status, 201, JSON.stringify(targeted.body));

  const targetedFeed = await send("/api/broadcasts/me", employee.token);
  assert.ok(targetedFeed.body.broadcasts.some((row) => row.id === targeted.body.id));
  const otherFeed = await send("/api/broadcasts/me", otherEmployee.token);
  assert.equal(
    otherFeed.body.broadcasts.some((row) => row.id === targeted.body.id),
    false,
  );

  assert.equal(
    (
      await send(
        `/api/workspaces/${tenantA.tenantId}/broadcasts`,
        employee.token,
        "POST",
        {
          title: "Tidak boleh",
          content: "Karyawan tidak memiliki izin mengelola broadcast.",
          audienceType: "ALL",
          priority: "NORMAL",
          publishNow: true,
        },
      )
    ).response.status,
    403,
  );
  assert.equal(
    (
      await send(
        `/api/workspaces/${tenantA.tenantId}/broadcasts`,
        tenantB.ownerToken,
      )
    ).response.status,
    403,
  );
  assert.equal(
    (
      await send(
        `/api/workspaces/${tenantA.tenantId}/broadcasts/${draft.body.id}/publish`,
        tenantB.ownerToken,
        "POST",
      )
    ).response.status,
    403,
  );

  const audit = await db.auditLog.findFirstOrThrow({
    where: { action: "broadcast.publish", resourceId: draft.body.id },
  });
  assert.equal(audit.tenantId, tenantA.tenantId);
});
