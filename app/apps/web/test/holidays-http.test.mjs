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
let employee;

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
  return { response, body: await response.json() };
}

before(async () => {
  db = adminClient();
  await resetDatabase(db);
  tenantA = await seedTenant(db, { name: "Holiday A" });
  tenantB = await seedTenant(db, { name: "Holiday B" });
  employee = await seedMember(db, tenantA.tenantId, tenantA.roles.VIEWER);

  const port = 4400 + randomInt(400);
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

test("C-HOL-1: create, list, duplicate, dan audit hari libur", async () => {
  const created = await send(
    `/api/workspaces/${tenantA.tenantId}/holidays`,
    tenantA.ownerToken,
    "POST",
    { date: "2026-12-25", name: "Hari Raya Natal" },
  );
  assert.equal(created.response.status, 201);
  assert.equal(created.body.date, "2026-12-25");
  assert.equal(created.body.name, "Hari Raya Natal");

  const list = await send(
    `/api/workspaces/${tenantA.tenantId}/holidays`,
    tenantA.ownerToken,
  );
  assert.equal(list.response.status, 200);
  assert.equal(list.body.holidays.length, 1);
  assert.equal(list.body.holidays[0].id, created.body.id);

  const duplicate = await send(
    `/api/workspaces/${tenantA.tenantId}/holidays`,
    tenantA.ownerToken,
    "POST",
    { date: "2026-12-25", name: "Natal lagi" },
  );
  assert.equal(duplicate.response.status, 409);
  assert.equal(duplicate.body.error.code, "HOLIDAY_EXISTS");

  const invalidDate = await send(
    `/api/workspaces/${tenantA.tenantId}/holidays`,
    tenantA.ownerToken,
    "POST",
    { date: "25-12-2026", name: "Salah format" },
  );
  assert.equal(invalidDate.response.status, 400);
  assert.equal(invalidDate.body.error.code, "INVALID_DATE");

  const emptyName = await send(
    `/api/workspaces/${tenantA.tenantId}/holidays`,
    tenantA.ownerToken,
    "POST",
    { date: "2026-12-31", name: "   " },
  );
  assert.equal(emptyName.response.status, 400);
  assert.equal(emptyName.body.error.code, "INVALID_NAME");

  const audit = await db.auditLog.findFirstOrThrow({
    where: { action: "workspace.holiday_create", resourceId: created.body.id },
  });
  assert.equal(audit.tenantId, tenantA.tenantId);
  assert.equal(audit.actorUserId, tenantA.ownerUserId);
  assert.equal(audit.actorMemberId, tenantA.ownerMemberId);
  assert.equal(audit.ipHash?.length, 32);
  assert.deepEqual(audit.metadata, { date: "2026-12-25", name: "Hari Raya Natal" });
});

test("C-HOL-2: delete menghapus baris dan menulis audit", async () => {
  const list = await send(
    `/api/workspaces/${tenantA.tenantId}/holidays`,
    tenantA.ownerToken,
  );
  const holiday = list.body.holidays[0];

  const deleted = await send(
    `/api/workspaces/${tenantA.tenantId}/holidays/${holiday.id}`,
    tenantA.ownerToken,
    "DELETE",
  );
  assert.equal(deleted.response.status, 200);
  assert.equal(deleted.body.deleted, true);
  assert.equal(
    await db.workspaceHoliday.count({ where: { id: holiday.id } }),
    0,
  );

  const audit = await db.auditLog.findFirstOrThrow({
    where: { action: "workspace.holiday_delete", resourceId: holiday.id },
  });
  assert.deepEqual(audit.metadata, { date: "2026-12-25", name: "Hari Raya Natal" });

  const again = await send(
    `/api/workspaces/${tenantA.tenantId}/holidays/${holiday.id}`,
    tenantA.ownerToken,
    "DELETE",
  );
  assert.equal(again.response.status, 404);
  assert.equal(again.body.error.code, "HOLIDAY_NOT_FOUND");
});

test("C-HOL-3: non-admin dan cross-tenant ditolak 403 identik", async () => {
  const created = await send(
    `/api/workspaces/${tenantA.tenantId}/holidays`,
    tenantA.ownerToken,
    "POST",
    { date: "2027-01-01", name: "Tahun Baru" },
  );
  assert.equal(created.response.status, 201);

  const nonAdminList = await send(
    `/api/workspaces/${tenantA.tenantId}/holidays`,
    employee.token,
  );
  assert.equal(nonAdminList.response.status, 403);

  const nonAdminDelete = await send(
    `/api/workspaces/${tenantA.tenantId}/holidays/${created.body.id}`,
    employee.token,
    "DELETE",
  );
  assert.equal(nonAdminDelete.response.status, 403);

  const foreignList = await send(
    `/api/workspaces/${tenantB.tenantId}/holidays`,
    tenantA.ownerToken,
  );
  const missingList = await send(
    "/api/workspaces/00000000-0000-4000-8000-000000000000/holidays",
    tenantA.ownerToken,
  );
  assert.equal(foreignList.response.status, 403);
  assert.deepEqual(foreignList.body, missingList.body);

  const foreignDelete = await send(
    `/api/workspaces/${tenantB.tenantId}/holidays/${created.body.id}`,
    tenantA.ownerToken,
    "DELETE",
  );
  assert.equal(foreignDelete.response.status, 403);
  assert.equal(
    await db.workspaceHoliday.count({ where: { id: created.body.id } }),
    1,
  );
});
