import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
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
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 42, 43, 0xff, 0xd9]);

let db;
let server;
let baseUrl;
let proofDir;
let tenantA;
let tenantB;
let ownerA;
let colleagueA;
let employeeB;
let adminA;
let withProofId;
let withoutProofId;

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

async function fetchProof(correctionId, token) {
  const response = await fetch(`${baseUrl}/api/corrections/${correctionId}/proof`, {
    headers: { authorization: `Bearer ${token}`, connection: "close" },
  });
  return {
    response,
    bytes: new Uint8Array(await response.arrayBuffer()),
  };
}

async function createCorrection({ tenantId, memberId, proofUrl }) {
  const id = randomUUID();
  await db.correctionRequest.create({
    data: {
      id,
      tenantId,
      memberId,
      requestType: "CHECK_IN",
      requestedTimestamp: new Date("2026-11-20T01:00:00Z"),
      reason: "Lupa check-in karena jaringan kantor terputus",
      proofUrl,
      proofHash: proofUrl ? "d".repeat(64) : null,
      status: "PENDING",
    },
  });
  return id;
}

before(async () => {
  db = adminClient();
  await resetDatabase(db);
  proofDir = await mkdtemp(join(tmpdir(), "absensi-proof-auth-"));
  tenantA = await seedTenant(db, { name: "Proof A" });
  tenantB = await seedTenant(db, { name: "Proof B" });
  ownerA = await seedMember(db, tenantA.tenantId, tenantA.roles.VIEWER);
  colleagueA = await seedMember(db, tenantA.tenantId, tenantA.roles.VIEWER);
  adminA = await seedMember(db, tenantA.tenantId, tenantA.roles.WORKSPACE_ADMIN);
  employeeB = await seedMember(db, tenantB.tenantId, tenantB.roles.VIEWER);

  const filename = `${randomUUID()}.jpg`;
  await writeFile(join(proofDir, filename), JPEG);
  withProofId = await createCorrection({
    tenantId: tenantA.tenantId,
    memberId: ownerA.memberId,
    proofUrl: `/uploads/proofs/${filename}`,
  });
  withoutProofId = await createCorrection({
    tenantId: tenantA.tenantId,
    memberId: ownerA.memberId,
    proofUrl: null,
  });

  const port = await freePort();
  baseUrl = `http://127.0.0.1:${port}`;
  server = spawn(join(root, "node_modules", ".bin", "next"), ["start", "-p", String(port)], {
    cwd: join(root, "apps", "web"),
    env: {
      ...process.env,
      NODE_ENV: "production",
      S1_RATE_LIMITER: "memory",
      ATTENDANCE_PROOF_DIR: proofDir,
      EMAIL_TRANSPORT: "memory",
      PUSH_TRANSPORT: "memory",
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

test("PR-1: pemilik revisi dapat mengunduh bukti (200, isi identik)", async () => {
  const { response, bytes } = await fetchProof(withProofId, ownerA.token);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "image/jpeg");
  // Middleware API menetapkan no-store untuk seluruh route /api.
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(bytes, JPEG);
});

test("PR-2: reviewer tenant sama dapat mengakses bukti", async () => {
  const { response, bytes } = await fetchProof(withProofId, adminA.token);
  assert.equal(response.status, 200);
  assert.deepEqual(bytes, JPEG);
});

test("PR-3: member lain dan tenant asing ditolak 403", async () => {
  const colleague = await fetchProof(withProofId, colleagueA.token);
  assert.equal(colleague.response.status, 403);
  assert.equal(colleague.bytes.length > 0, true);

  const foreign = await fetchProof(withProofId, employeeB.token);
  assert.equal(foreign.response.status, 403);
});

test("PR-4: revisi tanpa bukti dan revisi tidak ada sama-sama 404", async () => {
  const missingProof = await fetchProof(withoutProofId, ownerA.token);
  assert.equal(missingProof.response.status, 404);

  const missingCorrection = await fetchProof(randomUUID(), ownerA.token);
  assert.equal(missingCorrection.response.status, 404);
});
