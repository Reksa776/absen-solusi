import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomInt } from "node:crypto";
import { join } from "node:path";
import test, { after, before } from "node:test";

import {
  adminClient,
  resetDatabase,
  seedTenant,
} from "../../../packages/auth/dist/test-support.js";
import { generateTotpCode, hashPassword } from "../../../packages/auth/dist/index.js";

const root = new URL("../../../", import.meta.url).pathname;
const PASSWORD = "Password-2fa-kuat-123";
const KEY = "d".repeat(64);

let db;
let server;
let baseUrl;
let tenant;

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

async function post(path, body, token) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-auth-mode": "bearer",
      connection: "close",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  return { response, body: await response.json() };
}

before(async () => {
  db = adminClient();
  await resetDatabase(db);
  tenant = await seedTenant(db, {
    name: "Tenant 2FA",
    passwordHash: await hashPassword(PASSWORD),
  });
  const port = 3800 + randomInt(400);
  baseUrl = `http://127.0.0.1:${port}`;
  server = spawn(join(root, "node_modules", ".bin", "next"), ["start", "-p", String(port)], {
    cwd: join(root, "apps", "web"),
    env: {
      ...process.env,
      NODE_ENV: "production",
      S1_RATE_LIMITER: "memory",
      TWO_FACTOR_ENCRYPTION_KEY: KEY,
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
});

test("2FA-HTTP-1: setup, TOTP, backup code, challenge, disable, dan audit tanpa secret", async () => {
  const firstLogin = await post("/api/auth/login", {
    email: tenant.ownerEmail,
    password: PASSWORD,
  });
  assert.equal(firstLogin.response.status, 200);
  assert.ok(firstLogin.body.token);
  const sessionToken = firstLogin.body.token;

  const setup = await post("/api/auth/2fa/setup", {}, sessionToken);
  assert.equal(setup.response.status, 200);
  assert.match(setup.body.secret, /^[A-Z2-7]+$/);
  assert.match(setup.body.otpauthUri, /^otpauth:\/\/totp\//);
  assert.equal(setup.body.backupCodes.length, 10);
  assert.equal(JSON.stringify(setup.body).includes(KEY), false);

  const wrongSetup = await post("/api/auth/2fa/verify-setup", { code: "000000" }, sessionToken);
  assert.equal(wrongSetup.response.status, 400);
  assert.equal(wrongSetup.body.error.code, "INVALID_2FA_CODE");
  const stillDisabled = await db.user.findUniqueOrThrow({ where: { id: tenant.ownerUserId } });
  assert.equal(stillDisabled.twoFactorEnabled, false);
  assert.notEqual(stillDisabled.twoFactorSecret, setup.body.secret);
  assert.match(stillDisabled.twoFactorSecret, /^v1\./);

  const setupCode = generateTotpCode(setup.body.secret);
  const verified = await post("/api/auth/2fa/verify-setup", { code: setupCode }, sessionToken);
  assert.equal(verified.response.status, 200);
  assert.equal(verified.body.enabled, true);
  const enabledRow = await db.user.findUniqueOrThrow({ where: { id: tenant.ownerUserId } });
  assert.equal(enabledRow.twoFactorEnabled, true);

  const secondSetup = await post("/api/auth/2fa/setup", {}, sessionToken);
  assert.equal(secondSetup.response.status, 409);
  assert.equal(secondSetup.body.error.code, "TWO_FACTOR_ALREADY_ENABLED");

  const challenged = await post("/api/auth/login", {
    email: tenant.ownerEmail,
    password: PASSWORD,
  });
  assert.equal(challenged.response.status, 202);
  assert.equal(challenged.body.requiresTwoFactor, true);
  assert.ok(challenged.body.challengeToken);
  assert.equal("token" in challenged.body, false);

  const tampered = await post("/api/auth/login/2fa", {
    challengeToken: `${challenged.body.challengeToken.slice(0, -1)}x`,
    code: setupCode,
  });
  assert.equal(tampered.response.status, 401);
  assert.equal(tampered.body.error.code, "INVALID_2FA_CHALLENGE");

  const invalid = await post("/api/auth/login/2fa", {
    challengeToken: challenged.body.challengeToken,
    code: "000000",
  });
  assert.equal(invalid.response.status, 401);
  assert.equal(invalid.body.error.code, "INVALID_2FA_CODE");

  const completed = await post("/api/auth/login/2fa", {
    challengeToken: challenged.body.challengeToken,
    code: generateTotpCode(setup.body.secret),
  });
  assert.equal(completed.response.status, 200);
  assert.ok(completed.body.token);
  assert.equal(completed.body.user.id, tenant.ownerUserId);

  const backupLogin = await post("/api/auth/login", {
    email: tenant.ownerEmail,
    password: PASSWORD,
  });
  assert.equal(backupLogin.response.status, 202);
  const backupCode = setup.body.backupCodes[0];
  const backupCompleted = await post("/api/auth/login/2fa", {
    challengeToken: backupLogin.body.challengeToken,
    code: backupCode,
  });
  assert.equal(backupCompleted.response.status, 200);
  assert.ok(backupCompleted.body.token);

  const reuseLogin = await post("/api/auth/login", {
    email: tenant.ownerEmail,
    password: PASSWORD,
  });
  assert.equal(reuseLogin.response.status, 202);
  const reused = await post("/api/auth/login/2fa", {
    challengeToken: reuseLogin.body.challengeToken,
    code: backupCode,
  });
  assert.equal(reused.response.status, 401);
  assert.equal(reused.body.error.code, "INVALID_2FA_CODE");

  const wrongPassword = await post(
    "/api/auth/2fa/disable",
    { password: "password-salah", code: generateTotpCode(setup.body.secret) },
    backupCompleted.body.token,
  );
  assert.equal(wrongPassword.response.status, 401);
  const wrongDisableCode = await post(
    "/api/auth/2fa/disable",
    { password: PASSWORD, code: "000000" },
    backupCompleted.body.token,
  );
  assert.equal(wrongDisableCode.response.status, 401);
  const disabled = await post(
    "/api/auth/2fa/disable",
    { password: PASSWORD, code: generateTotpCode(setup.body.secret) },
    backupCompleted.body.token,
  );
  assert.equal(disabled.response.status, 200);
  assert.equal(disabled.body.enabled, false);
  const disabledRow = await db.user.findUniqueOrThrow({ where: { id: tenant.ownerUserId } });
  assert.equal(disabledRow.twoFactorEnabled, false);
  assert.equal(disabledRow.twoFactorSecret, null);

  const finalLogin = await post("/api/auth/login", {
    email: tenant.ownerEmail,
    password: PASSWORD,
  });
  assert.equal(finalLogin.response.status, 200);
  assert.ok(finalLogin.body.token);

  const audits = await db.auditLog.findMany({
    where: { action: { startsWith: "auth.two_factor" } },
  });
  assert.deepEqual(
    audits.map((row) => row.action).sort(),
    ["auth.two_factor_disabled", "auth.two_factor_enabled", "auth.two_factor_setup"],
  );
  const serialized = JSON.stringify(audits.map((row) => row.metadata));
  assert.equal(serialized.includes(setup.body.secret), false);
  assert.equal(serialized.includes(backupCode), false);
  assert.equal(serialized.includes(PASSWORD), false);
});
