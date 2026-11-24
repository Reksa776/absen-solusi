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
const PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
]);

let db;
let server;
let baseUrl;
let logoDir;
let tenantA;
let tenantB;
let employeeA;
let employeeB;
let outsiderA;
let approverOne;
let approverTwo;
let approverThree;

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
  return {
    response,
    body: await response.json().catch(() => ({})),
  };
}

async function uploadLogo(token, bytes, filename, contentType) {
  const form = new FormData();
  form.append("logo", new Blob([bytes], { type: contentType }), filename);
  const response = await fetch(
    `${baseUrl}/api/workspaces/${tenantA.tenantId}/settings/company/logo`,
    {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, connection: "close" },
      body: form,
    },
  );
  return {
    response,
    body: await response.json().catch(() => ({})),
  };
}

before(async () => {
  db = adminClient();
  await resetDatabase(db);
  logoDir = await mkdtemp(join(tmpdir(), "absensi-company-logo-"));
  tenantA = await seedTenant(db, { name: "Logo A" });
  tenantB = await seedTenant(db, { name: "Logo B" });
  employeeA = await seedMember(db, tenantA.tenantId, tenantA.roles.VIEWER);
  employeeB = await seedMember(db, tenantB.tenantId, tenantB.roles.VIEWER);
  outsiderA = await seedMember(db, tenantA.tenantId, tenantA.roles.VIEWER);
  approverOne = await seedMember(db, tenantA.tenantId, tenantA.roles.VIEWER);
  approverTwo = await seedMember(db, tenantA.tenantId, tenantA.roles.VIEWER);
  approverThree = await seedMember(db, tenantA.tenantId, tenantA.roles.VIEWER);

  const port = 4600 + randomInt(300);
  baseUrl = `http://127.0.0.1:${port}`;
  server = spawn(join(root, "node_modules", ".bin", "next"), ["start", "-p", String(port)], {
    cwd: join(root, "apps", "web"),
    env: {
      ...process.env,
      NODE_ENV: "production",
      S1_RATE_LIMITER: "memory",
      COMPANY_LOGO_DIR: logoDir,
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
  if (logoDir) await rm(logoDir, { recursive: true, force: true });
  if (db) await db.$disconnect();
});

test("logo perusahaan: validasi, isolasi tenant, akses web/mobile, dan hapus", async () => {
  const denied = await uploadLogo(employeeA.token, PNG, "logo.png", "image/png");
  assert.equal(denied.response.status, 403);

  const invalid = await uploadLogo(
    tenantA.ownerToken,
    new TextEncoder().encode("bukan gambar"),
    "logo.txt",
    "text/plain",
  );
  assert.equal(invalid.response.status, 400);
  assert.equal(invalid.body.error.code, "INVALID_COMPANY_LOGO");

  const oversized = await uploadLogo(
    tenantA.ownerToken,
    new Uint8Array(2 * 1024 * 1024 + 1),
    "besar.png",
    "image/png",
  );
  assert.equal(oversized.response.status, 400);

  const uploaded = await uploadLogo(tenantA.ownerToken, PNG, "logo.png", "image/png");
  assert.equal(uploaded.response.status, 201, JSON.stringify(uploaded.body));
  assert.equal(uploaded.body.logoUrl, `/api/workspaces/${tenantA.tenantId}/settings/company/logo`);

  const webLogo = await fetch(`${baseUrl}${uploaded.body.logoUrl}`, {
    headers: { authorization: `Bearer ${tenantA.ownerToken}`, connection: "close" },
  });
  assert.equal(webLogo.status, 200);
  assert.match(webLogo.headers.get("content-type") ?? "", /image\/png/);
  assert.deepEqual(new Uint8Array(await webLogo.arrayBuffer()), PNG);

  const mobileLogo = await fetch(`${baseUrl}/api/mobile/company/logo`, {
    headers: { authorization: `Bearer ${employeeA.token}`, connection: "close" },
  });
  assert.equal(mobileLogo.status, 200);
  assert.deepEqual(new Uint8Array(await mobileLogo.arrayBuffer()), PNG);

  const foreign = await fetch(`${baseUrl}${uploaded.body.logoUrl}`, {
    headers: { authorization: `Bearer ${tenantB.ownerToken}`, connection: "close" },
  });
  assert.equal(foreign.status, 403);

  const profile = await send(
    `/api/workspaces/${tenantA.tenantId}/settings/company`,
    tenantA.ownerToken,
  );
  assert.equal(profile.body.logoUrl, uploaded.body.logoUrl);

  const audit = await db.auditLog.findFirst({
    where: { action: "company.logo_upload", tenantId: tenantA.tenantId },
  });
  assert.ok(audit);

  const removed = await send(
    `/api/workspaces/${tenantA.tenantId}/settings/company/logo`,
    tenantA.ownerToken,
    "DELETE",
  );
  assert.equal(removed.response.status, 200);
  assert.equal(removed.body.deleted, true);

  const afterDelete = await fetch(`${baseUrl}/api/mobile/company/logo`, {
    headers: { authorization: `Bearer ${employeeA.token}`, connection: "close" },
  });
  assert.equal(afterDelete.status, 404);
});

test("alur persetujuan: multi-approver per level dan hak approve berdasarkan karyawan", async () => {
  const crossTenant = await send(
    `/api/workspaces/${tenantA.tenantId}/approval-workflows`,
    tenantA.ownerToken,
    "POST",
    {
      requestType: "LEAVE",
      steps: [{ approverMemberIds: [employeeB.memberId] }],
    },
  );
  assert.equal(crossTenant.response.status, 400);
  assert.equal(crossTenant.body.error.code, "INVALID_APPROVER_MEMBER");

  const saved = await send(
    `/api/workspaces/${tenantA.tenantId}/approval-workflows`,
    tenantA.ownerToken,
    "POST",
    {
      requestType: "LEAVE",
      steps: [
        {
          approverMemberIds: [approverOne.memberId, approverTwo.memberId],
        },
        { approverMemberIds: [approverThree.memberId] },
      ],
    },
  );
  assert.equal(saved.response.status, 201, JSON.stringify(saved.body));
  assert.equal(saved.body.steps.length, 2);
  assert.deepEqual(
    new Set(saved.body.steps[0].approverMemberIds),
    new Set([approverOne.memberId, approverTwo.memberId]),
  );
  assert.equal(saved.body.steps[0].approvers.length, 2);

  const listed = await send(
    `/api/workspaces/${tenantA.tenantId}/approval-workflows`,
    employeeA.token,
  );
  assert.equal(listed.response.status, 200);
  assert.equal(listed.body.workflows.length, 1);
  assert.ok(
    listed.body.candidates.some((row) => row.memberId === approverOne.memberId),
  );

  const leaveId = randomUUID();
  await db.leaveRequest.create({
    data: {
      id: leaveId,
      tenantId: tenantA.tenantId,
      memberId: employeeA.memberId,
      leaveType: "LAINNYA",
      startDate: new Date("2026-12-01T00:00:00.000Z"),
      endDate: new Date("2026-12-01T00:00:00.000Z"),
      workingDays: 1,
      reason: "Keperluan keluarga yang mendesak",
      status: "PENDING",
    },
  });

  const outsider = await send(
    `/api/leave/${leaveId}`,
    outsiderA.token,
    "PATCH",
    { action: "APPROVE" },
  );
  assert.equal(outsider.response.status, 403);
  assert.equal(outsider.body.error.code, "APPROVAL_STEP_FORBIDDEN");

  const levelOne = await send(
    `/api/leave/${leaveId}`,
    approverOne.token,
    "PATCH",
    { action: "APPROVE" },
  );
  assert.equal(levelOne.response.status, 200, JSON.stringify(levelOne.body));
  assert.equal(levelOne.body.status, "PENDING");

  const secondApproverAtNextLevel = await send(
    `/api/leave/${leaveId}`,
    approverTwo.token,
    "PATCH",
    { action: "APPROVE" },
  );
  assert.equal(secondApproverAtNextLevel.response.status, 403);

  const levelTwo = await send(
    `/api/leave/${leaveId}`,
    approverThree.token,
    "PATCH",
    { action: "APPROVE" },
  );
  assert.equal(levelTwo.response.status, 200, JSON.stringify(levelTwo.body));
  assert.equal(levelTwo.body.status, "APPROVED");

  const stored = await db.leaveRequest.findUniqueOrThrow({ where: { id: leaveId } });
  assert.equal(stored.status, "APPROVED");
  assert.equal(stored.currentApprovalLevel, 2);
  assert.equal(
    await db.approvalStepApprover.count({ where: { tenantId: tenantA.tenantId } }),
    3,
  );
});

test("kalender libur: tambah, edit, muat nasional idempoten, dan hapus", async () => {
  const created = await send(
    `/api/workspaces/${tenantA.tenantId}/holidays`,
    tenantA.ownerToken,
    "POST",
    { date: "2026-12-24", name: "Cuti bersama Natal" },
  );
  assert.equal(created.response.status, 201);

  const updated = await send(
    `/api/workspaces/${tenantA.tenantId}/holidays/${created.body.id}`,
    tenantA.ownerToken,
    "PATCH",
    { date: "2026-12-24", name: "Cuti bersama Natal 2026" },
  );
  assert.equal(updated.response.status, 200);
  assert.equal(updated.body.name, "Cuti bersama Natal 2026");

  const firstImport = await send(
    `/api/workspaces/${tenantA.tenantId}/holidays/import-national`,
    tenantA.ownerToken,
    "POST",
    { year: 2026 },
  );
  assert.equal(firstImport.response.status, 200, JSON.stringify(firstImport.body));
  assert.ok(firstImport.body.created > 0);
  assert.equal(firstImport.body.skipped, 0);

  const secondImport = await send(
    `/api/workspaces/${tenantA.tenantId}/holidays/import-national`,
    tenantA.ownerToken,
    "POST",
    { year: 2026 },
  );
  assert.equal(secondImport.response.status, 200);
  assert.equal(secondImport.body.created, 0);
  assert.equal(secondImport.body.skipped, firstImport.body.created);

  const dates = await db.workspaceHoliday.findMany({
    where: { tenantId: tenantA.tenantId },
    select: { date: true },
  });
  assert.equal(
    new Set(dates.map((row) => row.date.toISOString().slice(0, 10))).size,
    dates.length,
  );

  const denied = await send(
    `/api/workspaces/${tenantA.tenantId}/holidays/import-national`,
    employeeA.token,
    "POST",
    { year: 2026 },
  );
  assert.equal(denied.response.status, 403);

  const deleted = await send(
    `/api/workspaces/${tenantA.tenantId}/holidays/${created.body.id}`,
    tenantA.ownerToken,
    "DELETE",
  );
  assert.equal(deleted.response.status, 200);
  assert.equal(
    await db.workspaceHoliday.count({ where: { id: created.body.id } }),
    0,
  );

  const updateAudit = await db.auditLog.findFirst({
    where: { action: "workspace.holiday_update", resourceId: created.body.id },
  });
  assert.ok(updateAudit);
  const importAudit = await db.auditLog.findFirst({
    where: {
      action: "workspace.holiday_import_national",
      tenantId: tenantA.tenantId,
    },
  });
  assert.ok(importAudit);
});
