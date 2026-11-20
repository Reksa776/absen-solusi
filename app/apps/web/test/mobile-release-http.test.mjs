import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomInt, randomUUID } from "node:crypto";
import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
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

let db;
let server;
let baseUrl;
let releaseDir;
let tenantA;
let employee;

const fallback = {
  latestVersion: "1.0.0",
  buildNumber: 1,
  forceUpdate: false,
  changelog: "",
  downloadUrl: "",
};

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

async function getJson(path) {
  const response = await fetch(`${baseUrl}${path}`, {
    headers: { connection: "close" },
  });
  return { response, body: await response.json() };
}

before(async () => {
  db = adminClient();
  await resetDatabase(db);
  tenantA = await seedTenant(db, { name: "Release A" });
  employee = await seedMember(db, tenantA.tenantId, tenantA.roles.VIEWER);

  releaseDir = await mkdtemp(join(tmpdir(), "absensi-releases-"));
  const port = 3800 + randomInt(300);
  baseUrl = `http://127.0.0.1:${port}`;
  // server.mjs adalah entry produksi: menangani unduhan APK dengan
  // Content-Length, lalu meneruskan sisanya ke Next.
  server = spawn(process.execPath, ["server.mjs"], {
    cwd: join(root, "apps", "web"),
    env: {
      ...process.env,
      NODE_ENV: "production",
      PORT: String(port),
      HOSTNAME: "127.0.0.1",
      S1_RATE_LIMITER: "memory",
      MOBILE_RELEASE_DIR: releaseDir,
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
  if (releaseDir) await rm(releaseDir, { recursive: true, force: true });
});

test("M1: versi default dipakai saat version.json belum ada", async () => {
  const { response, body } = await getJson("/api/mobile/version");
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(body, fallback);
});

test("M2: metadata mengikuti version.json yang diunggah", async () => {
  await writeFile(
    join(releaseDir, "version.json"),
    JSON.stringify({
      latestVersion: "1.4.2",
      buildNumber: 7,
      forceUpdate: true,
      changelog: "Perbaikan kamera depan dan GPS.",
      downloadUrl: "/api/mobile/apk/latest",
    }),
  );

  const { response, body } = await getJson("/api/mobile/version");
  assert.equal(response.status, 200);
  assert.deepEqual(body, {
    latestVersion: "1.4.2",
    buildNumber: 7,
    forceUpdate: true,
    changelog: "Perbaikan kamera depan dan GPS.",
    downloadUrl: "/api/mobile/apk/latest",
  });
});

test("M3: version.json rusak jatuh ke metadata default", async () => {
  await writeFile(join(releaseDir, "version.json"), "{ bukan json");
  const { response, body } = await getJson("/api/mobile/version");
  assert.equal(response.status, 200);
  assert.deepEqual(body, fallback);
});

test("M4: APK belum diunggah menghasilkan 404", async () => {
  const { response, body } = await getJson("/api/mobile/apk/latest");
  assert.equal(response.status, 404);
  assert.equal(body.error.code, "APK_NOT_FOUND");
});

test("M5: APK diunduh streaming dengan header installer dan Content-Length", async () => {
  const bytes = Buffer.from("PK\u0003\u0004absensi-apk-payload", "binary");
  await writeFile(join(releaseDir, "absensi-mobile.apk"), bytes);

  const response = await fetch(`${baseUrl}/api/mobile/apk/latest`, {
    headers: { connection: "close" },
  });
  assert.equal(response.status, 200);
  assert.equal(
    response.headers.get("content-type"),
    "application/vnd.android.package-archive",
  );
  assert.equal(
    response.headers.get("content-disposition"),
    'attachment; filename="absensi-mobile.apk"',
  );
  assert.equal(Number(response.headers.get("content-length")), bytes.length);
  assert.equal(
    Number((await stat(join(releaseDir, "absensi-mobile.apk"))).size),
    bytes.length,
  );
  const received = Buffer.from(await response.arrayBuffer());
  assert.deepEqual(received, bytes);
});

test("M6: unggah rilis tanpa sesi ditolak", async () => {
  const form = new FormData();
  form.set("latestVersion", "1.5.0");
  form.set("buildNumber", "8");
  form.set("apk", new Blob([Buffer.from("apk")]), "absensi-mobile.apk");

  const response = await fetch(
    `${baseUrl}/api/workspaces/${randomUUID()}/app-release`,
    { method: "POST", body: form, headers: { connection: "close" } },
  );
  assert.equal(response.status, 401);
  const body = await response.json();
  assert.equal(body.error.code, "UNAUTHENTICATED");
});

function releaseForm(version, buildNumber, bytes) {
  const form = new FormData();
  form.set("latestVersion", version);
  form.set("buildNumber", String(buildNumber));
  form.set("forceUpdate", "true");
  form.set("changelog", "Kamera depan lebih stabil.");
  form.set("apk", new Blob([bytes]), "absensi-mobile.apk");
  return form;
}

test("M7: admin mengunggah rilis dan metadata langsung berlaku", async () => {
  const bytes = Buffer.from("PK-uploaded-apk-bytes");
  const uploaded = await fetch(
    `${baseUrl}/api/workspaces/${tenantA.tenantId}/app-release`,
    {
      method: "POST",
      body: releaseForm("1.3.0", 9, bytes),
      headers: {
        authorization: `Bearer ${tenantA.ownerToken}`,
        connection: "close",
      },
    },
  );
  assert.equal(uploaded.status, 201);
  const payload = await uploaded.json();
  assert.equal(payload.version.latestVersion, "1.3.0");
  assert.equal(payload.version.buildNumber, 9);
  assert.equal(payload.version.forceUpdate, true);
  assert.equal(payload.version.downloadUrl, "/api/mobile/apk/latest");

  const metadata = await getJson("/api/mobile/version");
  assert.equal(metadata.body.latestVersion, "1.3.0");
  assert.equal(metadata.body.buildNumber, 9);
  assert.equal(metadata.body.forceUpdate, true);
  assert.equal(metadata.body.changelog, "Kamera depan lebih stabil.");

  const download = await fetch(`${baseUrl}/api/mobile/apk/latest`, {
    headers: { connection: "close" },
  });
  assert.equal(download.status, 200);
  assert.deepEqual(Buffer.from(await download.arrayBuffer()), bytes);

  const denied = await fetch(
    `${baseUrl}/api/workspaces/${tenantA.tenantId}/app-release`,
    {
      method: "POST",
      body: releaseForm("1.3.1", 10, Buffer.from("nope")),
      headers: {
        authorization: `Bearer ${employee.token}`,
        connection: "close",
      },
    },
  );
  assert.equal(denied.status, 403);
  assert.equal((await getJson("/api/mobile/version")).body.latestVersion, "1.3.0");
});
