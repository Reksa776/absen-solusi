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
let admin;
let employeeOne;
let employeeTwo;

function dayKey(offset = 0) {
  return new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
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

before(async () => {
  db = adminClient();
  await resetDatabase(db);
  tenantA = await seedTenant(db, { name: "WFH Review A" });
  tenantB = await seedTenant(db, { name: "WFH Review B" });
  admin = await seedMember(db, tenantA.tenantId, tenantA.roles.WORKSPACE_ADMIN);
  employeeOne = await seedMember(db, tenantA.tenantId, tenantA.roles.EMPLOYEE);
  employeeTwo = await seedMember(db, tenantA.tenantId, tenantA.roles.EMPLOYEE);

  const division = await db.division.create({
    data: {
      id: randomUUID(),
      tenantId: tenantA.tenantId,
      name: "Operasional",
    },
  });
  const position = await db.position.create({
    data: {
      id: randomUUID(),
      tenantId: tenantA.tenantId,
      divisionId: division.id,
      name: "Staff",
    },
  });
  await db.workspaceMember.updateMany({
    where: { tenantId: tenantA.tenantId, id: employeeOne.memberId },
    data: { divisionId: division.id, positionId: position.id },
  });

  const port = 3900 + randomInt(90);
  baseUrl = `http://127.0.0.1:${port}`;
  server = spawn(
    join(root, "node_modules", ".bin", "next"),
    ["start", "-p", String(port)],
    {
      cwd: join(root, "apps", "web"),
      env: {
        ...process.env,
        NODE_ENV: "production",
        S1_RATE_LIMITER: "memory",
      },
      stdio: ["ignore", "pipe", "pipe"],
      detached: true,
    },
  );
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
});

test("WFH-1: admin melihat antrean, menyetujui, dan menolak dengan notifikasi", async () => {
  const first = await send("/api/wfh", employeeOne.token, "POST", {
    date: dayKey(1),
    reason: "Perbaikan jaringan kantor membuat WFH lebih efektif",
  });
  assert.equal(first.response.status, 201, JSON.stringify(first.body));

  const second = await send("/api/wfh", employeeTwo.token, "POST", {
    date: dayKey(2),
    reason: "Menunggu teknisi datang ke rumah untuk instalasi",
  });
  assert.equal(second.response.status, 201, JSON.stringify(second.body));

  const queue = await send(
    `/api/workspaces/${tenantA.tenantId}/wfh?status=PENDING`,
    admin.token,
  );
  assert.equal(queue.response.status, 200, JSON.stringify(queue.body));
  assert.equal(queue.body.wfh.length, 2);
  const firstRow = queue.body.wfh.find((row) => row.id === first.body.id);
  assert.equal(firstRow.memberName.length > 0, true);
  assert.equal(firstRow.memberDivision, "Operasional");
  assert.equal(firstRow.memberPosition, "Staff");

  assert.equal(
    (await send(`/api/workspaces/${tenantA.tenantId}/wfh`, employeeOne.token))
      .response.status,
    403,
  );
  assert.equal(
    (await send(`/api/workspaces/${tenantA.tenantId}/wfh`, tenantB.ownerToken))
      .response.status,
    403,
  );

  const approved = await send(
    `/api/workspaces/${tenantA.tenantId}/wfh/${first.body.id}/review`,
    admin.token,
    "POST",
    { action: "APPROVE" },
  );
  assert.equal(approved.response.status, 200, JSON.stringify(approved.body));
  assert.equal(approved.body.status, "APPROVED");

  const approvedNote = await db.inAppNotification.findFirst({
    where: {
      tenantId: tenantA.tenantId,
      memberId: employeeOne.memberId,
      type: "WFH_APPROVED",
    },
  });
  assert.ok(approvedNote);
  assert.match(approvedNote.body, new RegExp(first.body.date));

  const rejectReason = "Operasional kantor membutuhkan kehadiran langsung";
  const rejected = await send(
    `/api/workspaces/${tenantA.tenantId}/wfh/${second.body.id}/review`,
    admin.token,
    "POST",
    { action: "REJECT", rejectionReason: rejectReason },
  );
  assert.equal(rejected.response.status, 200, JSON.stringify(rejected.body));
  assert.equal(rejected.body.status, "REJECTED");

  const rejectedNote = await db.inAppNotification.findFirst({
    where: {
      tenantId: tenantA.tenantId,
      memberId: employeeTwo.memberId,
      type: "WFH_REJECTED",
    },
  });
  assert.ok(rejectedNote);
  assert.match(rejectedNote.body, /Catatan admin:/);
  assert.equal(rejectedNote.body.includes(rejectReason), true);

  const inbox = await send("/api/notifications/me", employeeOne.token);
  assert.equal(inbox.response.status, 200);
  assert.equal(inbox.body.unreadCount, 1);
  assert.equal(inbox.body.notifications[0].type, "WFH_APPROVED");

  const again = await send(
    `/api/workspaces/${tenantA.tenantId}/wfh/${first.body.id}/review`,
    admin.token,
    "POST",
    { action: "REJECT", rejectionReason: "Sudah diproses sebelumnya" },
  );
  assert.equal(again.response.status, 409);

  const shortReason = await send(
    `/api/workspaces/${tenantA.tenantId}/wfh/${second.body.id}/review`,
    admin.token,
    "POST",
    { action: "REJECT", rejectionReason: "no" },
  );
  assert.equal(shortReason.response.status, 400);
  assert.equal(shortReason.body.error.code, "INVALID_REJECTION_REASON");

  const third = await send("/api/wfh", employeeOne.token, "POST", {
    date: dayKey(3),
    reason: "Menunggu hasil perbaikan jaringan kantor selesai",
  });
  assert.equal(third.response.status, 201);
  const tooShort = await send(
    `/api/workspaces/${tenantA.tenantId}/wfh/${third.body.id}/review`,
    admin.token,
    "POST",
    { action: "REJECT", rejectionReason: "no" },
  );
  assert.equal(tooShort.response.status, 400);
  assert.equal(tooShort.body.error.code, "INVALID_REJECTION_REASON");

  const crossTenant = await send(
    `/api/workspaces/${tenantA.tenantId}/wfh/${third.body.id}/review`,
    tenantB.ownerToken,
    "POST",
    { action: "APPROVE" },
  );
  assert.equal(crossTenant.response.status, 403);
});

test("WFH-2: approve dan reject lembur selalu membuat notifikasi bertanggal", async () => {
  const approvedRow = await send("/api/overtime", employeeOne.token, "POST", {
    date: dayKey(-4),
    startTime: "18:00",
    endTime: "20:00",
    reason: "Menutup laporan keuangan bulanan kantor",
  });
  assert.equal(approvedRow.response.status, 201, JSON.stringify(approvedRow.body));

  const rejectedRow = await send("/api/overtime", employeeTwo.token, "POST", {
    date: dayKey(-5),
    startTime: "18:00",
    endTime: "19:00",
    reason: "Menyelesaikan arsip dokumen kepegawaian",
  });
  assert.equal(rejectedRow.response.status, 201, JSON.stringify(rejectedRow.body));

  const approved = await send(
    `/api/overtime/${approvedRow.body.id}`,
    admin.token,
    "PATCH",
    { action: "APPROVE" },
  );
  assert.equal(approved.response.status, 200, JSON.stringify(approved.body));
  assert.equal(approved.body.status, "APPROVED");

  const reason = "Lembur tidak diperlukan karena target sudah tercapai";
  const rejected = await send(
    `/api/overtime/${rejectedRow.body.id}`,
    admin.token,
    "PATCH",
    { action: "REJECT", rejectionReason: reason },
  );
  assert.equal(rejected.response.status, 200, JSON.stringify(rejected.body));
  assert.equal(rejected.body.status, "REJECTED");

  const approvedNote = await db.inAppNotification.findFirst({
    where: {
      tenantId: tenantA.tenantId,
      memberId: employeeOne.memberId,
      type: "OVERTIME_APPROVED",
    },
  });
  assert.ok(approvedNote);
  assert.match(approvedNote.title, /disetujui/);
  assert.match(approvedNote.body, new RegExp(approvedRow.body.date));

  const rejectedNote = await db.inAppNotification.findFirst({
    where: {
      tenantId: tenantA.tenantId,
      memberId: employeeTwo.memberId,
      type: "OVERTIME_REJECTED",
    },
  });
  assert.ok(rejectedNote);
  assert.equal(rejectedNote.body.includes(reason), true);
});
