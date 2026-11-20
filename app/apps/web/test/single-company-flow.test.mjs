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
import { hashPassword, verifyPassword } from "../../../packages/auth/dist/index.js";

const root = new URL("../../../", import.meta.url).pathname;
const PASSWORD = "password-awal-123";
const NEW_PASSWORD = "password-baru-456";

let db;
let server;
let baseUrl;
let photoDir;
let tenant;
let admin;
let employee;
let employeeEmail;
let officeId;
let shiftId;

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

async function csrf() {
  const response = await fetch(`${baseUrl}/api/auth/csrf`, {
    headers: { connection: "close" },
  });
  const body = await response.json();
  assert.ok(body.csrfToken);
  return { token: body.csrfToken, cookie: `aos_csrf=${body.csrfToken}` };
}

async function loginWeb(email, password) {
  const token = await csrf();
  return fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    redirect: "manual",
    headers: {
      "content-type": "application/json",
      "x-csrf-token": token.token,
      cookie: token.cookie,
      connection: "close",
    },
    body: JSON.stringify({ email, password }),
  });
}

async function loginMobile(email, password) {
  const response = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-auth-mode": "bearer",
      connection: "close",
    },
    body: JSON.stringify({ email, password }),
  });
  return { response, body: await response.json() };
}

before(async () => {
  db = adminClient();
  await resetDatabase(db);
  tenant = await seedTenant(db, { name: "Single Company" });
  admin = await seedMember(db, tenant.tenantId, tenant.roles.WORKSPACE_ADMIN, {
    passwordHash: await hashPassword(PASSWORD),
  });
  employeeEmail = `employee-${randomUUID()}@test.local`;
  employee = await seedMember(db, tenant.tenantId, tenant.roles.EMPLOYEE, {
    email: employeeEmail,
    passwordHash: await hashPassword(PASSWORD),
  });
  officeId = randomUUID();
  await db.officeLocation.create({
    data: {
      id: officeId,
      tenantId: tenant.tenantId,
      name: "Kantor Utama",
      latitude: -6.2,
      longitude: 106.8,
      radiusMeters: 100,
      timezone: "Asia/Jakarta",
      workStart: "09:00",
      workEnd: "17:00",
    },
  });
  shiftId = randomUUID();
  await db.workShift.create({
    data: {
      id: shiftId,
      tenantId: tenant.tenantId,
      name: "Pagi",
      startTime: "09:00",
      endTime: "17:00",
    },
  });
  photoDir = await mkdtemp(join(tmpdir(), "absensi-single-company-"));

  const port = 3900 + randomInt(400);
  baseUrl = `http://127.0.0.1:${port}`;
  server = spawn(join(root, "node_modules", ".bin", "next"), ["start", "-p", String(port)], {
    cwd: join(root, "apps", "web"),
    env: {
      ...process.env,
      NODE_ENV: "production",
      COOKIE_SECURE: "false",
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
  if (photoDir) await rm(photoDir, { recursive: true, force: true });
});

test("SC-1: login web admin langsung ke dashboard dan / tidak menampilkan pemilih workspace", async () => {
  const response = await loginWeb(admin.email, PASSWORD);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.redirectTo, `/workspaces/${tenant.tenantId}/dashboard`);

  const home = await fetch(`${baseUrl}/`, {
    redirect: "manual",
    headers: { cookie: `aos_session=${tenant.ownerToken}`, connection: "close" },
  });
  assert.equal(home.status, 307);
  assert.equal(home.headers.get("location"), `/workspaces/${tenant.tenantId}/dashboard`);

  const workspaces = await fetch(`${baseUrl}/workspaces`, {
    redirect: "manual",
    headers: { cookie: `aos_session=${tenant.ownerToken}`, connection: "close" },
  });
  assert.equal(workspaces.status, 307);
  assert.equal(workspaces.headers.get("location"), `/workspaces/${tenant.tenantId}/dashboard`);
});

test("SC-2: login web EMPLOYEE ditolak, halaman web diarahkan ke pesan khusus, API mobile tetap boleh", async () => {
  const deniedLogin = await loginWeb(employeeEmail, PASSWORD);
  assert.equal(deniedLogin.status, 403);
  const deniedBody = await deniedLogin.json();
  assert.equal(deniedBody.error.code, "WEB_EMPLOYEE_FORBIDDEN");
  assert.match(deniedBody.error.message, /Akses web khusus untuk Admin\/HR/);

  for (const path of ["/", "/workspaces"]) {
    const response = await fetch(`${baseUrl}${path}`, {
      redirect: "manual",
      headers: { cookie: `aos_session=${employee.token}`, connection: "close" },
    });
    assert.equal(response.status, 307);
    assert.equal(response.headers.get("location"), "/web-access-denied");
  }

  const mobile = await loginMobile(employeeEmail, PASSWORD);
  assert.equal(mobile.response.status, 200);
  assert.ok(mobile.body.token);
  assert.equal(mobile.body.redirectTo, null);
});

test("SC-3: admin menambah karyawan langsung dengan Argon2, kantor, shift, dan audit", async () => {
  const email = `direct-${randomUUID()}@test.local`;
  const created = await send(`/api/workspaces/${tenant.tenantId}/members/direct`, admin.token, "POST", {
    name: "Karyawan Baru",
    email,
    password: NEW_PASSWORD,
    role: "EMPLOYEE",
    officeId,
    shiftId,
  });
  assert.equal(created.response.status, 201);
  assert.equal(created.body.email, email);
  assert.equal(created.body.status, "ACTIVE");
  assert.equal(created.body.officeId, officeId);
  assert.equal(created.body.shiftId, shiftId);

  const user = await db.user.findUniqueOrThrow({ where: { email } });
  assert.equal(user.status, "ACTIVE");
  assert.match(user.passwordHash, /^\$argon2id\$/);
  assert.equal(await verifyPassword(user.passwordHash, NEW_PASSWORD), true);

  const member = await db.workspaceMember.findFirstOrThrow({
    where: { tenantId: tenant.tenantId, userId: user.id },
    include: { roles: { include: { role: true } }, shifts: true },
  });
  assert.equal(member.status, "ACTIVE");
  assert.equal(member.officeLocationId, officeId);
  assert.deepEqual(member.roles.map((row) => row.role.key), ["EMPLOYEE"]);
  assert.equal(member.shifts[0]?.shiftId, shiftId);

  const audit = await db.auditLog.findFirstOrThrow({
    where: { action: "member.direct_create", resourceId: member.id },
  });
  assert.equal(audit.tenantId, tenant.tenantId);
  assert.equal(audit.metadata.email, email);

  const duplicate = await send(
    `/api/workspaces/${tenant.tenantId}/members/direct`,
    admin.token,
    "POST",
    { name: "Duplikat", email, password: NEW_PASSWORD, role: "EMPLOYEE" },
  );
  assert.equal(duplicate.response.status, 409);
  assert.equal(duplicate.body.error.code, "EMAIL_ALREADY_EXISTS");

  const weak = await send(
    `/api/workspaces/${tenant.tenantId}/members/direct`,
    admin.token,
    "POST",
    { name: "Lemah", email: `weak-${randomUUID()}@test.local`, password: "pendek", role: "EMPLOYEE" },
  );
  assert.equal(weak.response.status, 400);
  assert.equal(weak.body.error.code, "INVALID_PASSWORD");

  const forbidden = await send(
    `/api/workspaces/${tenant.tenantId}/members/direct`,
    employee.token,
    "POST",
    { name: "Tidak Boleh", email: `no-${randomUUID()}@test.local`, password: NEW_PASSWORD, role: "EMPLOYEE" },
  );
  assert.equal(forbidden.response.status, 403);
});

test("SC-4: reset password langsung mengganti hash dan mencabut semua sesi karyawan", async () => {
  const email = `reset-${randomUUID()}@test.local`;
  const created = await send(`/api/workspaces/${tenant.tenantId}/members/direct`, admin.token, "POST", {
    name: "Karyawan Reset",
    email,
    password: PASSWORD,
    role: "EMPLOYEE",
  });
  assert.equal(created.response.status, 201);

  const mobile = await loginMobile(email, PASSWORD);
  assert.equal(mobile.response.status, 200);
  const targetToken = mobile.body.token;
  assert.equal((await send("/api/auth/me", targetToken)).response.status, 200);

  const reset = await send(
    `/api/workspaces/${tenant.tenantId}/members/${created.body.memberId}/password`,
    admin.token,
    "PATCH",
    { password: NEW_PASSWORD },
  );
  assert.equal(reset.response.status, 200);
  assert.equal(reset.body.sessionsRevoked >= 1, true);

  const user = await db.user.findUniqueOrThrow({ where: { email } });
  assert.equal(await verifyPassword(user.passwordHash, NEW_PASSWORD), true);
  assert.equal(await verifyPassword(user.passwordHash, PASSWORD), false);
  assert.equal((await send("/api/auth/me", targetToken)).response.status, 401);

  const oldLogin = await loginMobile(email, PASSWORD);
  assert.equal(oldLogin.response.status, 401);
  const newLogin = await loginMobile(email, NEW_PASSWORD);
  assert.equal(newLogin.response.status, 200);

  const forbidden = await send(
    `/api/workspaces/${tenant.tenantId}/members/${created.body.memberId}/password`,
    employee.token,
    "PATCH",
    { password: NEW_PASSWORD },
  );
  assert.equal(forbidden.response.status, 403);

  const ownerTarget = await send(
    `/api/workspaces/${tenant.tenantId}/members/${tenant.ownerMemberId}/password`,
    admin.token,
    "PATCH",
    { password: NEW_PASSWORD },
  );
  assert.equal(ownerTarget.response.status, 403);
  assert.equal(ownerTarget.body.error.code, "ROLE_HIERARCHY_VIOLATION");
});
