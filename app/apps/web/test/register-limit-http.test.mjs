import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { join } from "node:path";
import test, { after, before } from "node:test";

import { adminClient, resetDatabase } from "../../../packages/auth/dist/test-support.js";

const root = new URL("../../../", import.meta.url).pathname;

let db;
let server;
let baseUrl;
let csrfToken;
let csrfCookie;

async function freePort() {
  return await new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      const port = typeof address === "object" && address ? address.port : 0;
      probe.close(() => resolve(port));
    });
  });
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

async function register(index) {
  const response = await fetch(`${baseUrl}/api/auth/register`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie: csrfCookie,
      "x-csrf-token": csrfToken,
      connection: "close",
    },
    body: JSON.stringify({
      email: `register-limit-${index}-${Date.now()}@example.com`,
      password: "RahasiaSekali123!",
      name: `Pendaftar ${index}`,
      workspaceName: `Workspace ${index}`,
    }),
  });
  return { response, body: await response.json().catch(() => ({})) };
}

before(async () => {
  // Bootstrap registration hanya terbuka saat belum ada user; mulai bersih.
  db = adminClient();
  await resetDatabase(db);

  const port = await freePort();
  baseUrl = `http://127.0.0.1:${port}`;
  server = spawn(join(root, "node_modules", ".bin", "next"), ["start", "-p", String(port)], {
    cwd: join(root, "apps", "web"),
    env: {
      ...process.env,
      NODE_ENV: "production",
      S1_RATE_LIMITER: "memory",
      ALLOW_REGISTRATION: "true",
      EMAIL_TRANSPORT: "memory",
      PUSH_TRANSPORT: "memory",
    },
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
  });
  server.stdout.on("data", (chunk) => process.stderr.write(chunk));
  server.stderr.on("data", (chunk) => process.stderr.write(chunk));
  await waitForReady();

  const csrf = await fetch(`${baseUrl}/api/auth/csrf`, {
    headers: { connection: "close" },
  });
  const body = await csrf.json();
  csrfToken = body.csrfToken;
  const setCookie = csrf.headers.getSetCookie();
  csrfCookie = (setCookie[0] ?? "").split(";")[0];
  assert.ok(csrfToken && csrfCookie, "CSRF token dan cookie wajib tersedia");
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

test("RL-HTTP-1: register publik melewati batas → 429 + Retry-After", async () => {
  // Bootstrap hanya membuka pendaftaran user pertama; percobaan berikutnya 403
  // tetapi tetap memakai bucket register. Percobaan keenam harus 429.
  const expected = [201, 403, 403, 403, 403, 429];
  for (let index = 0; index < expected.length; index += 1) {
    const attempt = await register(index);
    assert.equal(
      attempt.response.status,
      expected[index],
      `percobaan ${index + 1}: ${JSON.stringify(attempt.body)}`,
    );
    if (expected[index] === 403) {
      assert.equal(attempt.body.error.code, "REGISTRATION_CLOSED");
    }
    if (expected[index] === 429) {
      assert.equal(attempt.body.error.code, "RATE_LIMITED");
      const retryAfter = Number(attempt.response.headers.get("retry-after"));
      assert.ok(Number.isInteger(retryAfter) && retryAfter > 0);
    }
  }
});
