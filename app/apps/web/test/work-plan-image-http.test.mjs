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

const root = new URL("../../../", import.meta.url).pathname;

let db;
let server;
let baseUrl;
let tenant;

function pngWithText(text) {
  const signature = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  ]);
  const chunk = (type, data) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    return Buffer.concat([
      length,
      Buffer.from(type, "latin1"),
      data,
      Buffer.alloc(4),
    ]);
  };
  const textData = Buffer.concat([
    Buffer.from("Description", "latin1"),
    Buffer.from([0]),
    Buffer.from(text, "utf8"),
  ]);
  return Buffer.concat([
    signature,
    chunk("tEXt", textData),
    chunk("IEND", Buffer.alloc(0)),
  ]);
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

async function extract(path, token, bytes, type, filename) {
  const form = new FormData();
  form.set("image", new Blob([bytes], { type }), filename);
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      connection: "close",
    },
    body: form,
  });
  return { response, body: await response.json().catch(() => ({})) };
}

before(async () => {
  db = adminClient();
  await resetDatabase(db);
  tenant = await seedTenant(db, { name: "Work Plan Image" });

  const port = 4600 + randomInt(90);
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
        // Jangan unduh traineddata tesseract saat suite berjalan.
        WORK_PLAN_OCR_DISABLED: "1",
        GEMINI_API_KEY: "",
        OPENAI_API_KEY: "",
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

test("IMAGE-1: gambar rencana kerja dibaca menjadi to-do list bersih", async () => {
  const png = pngWithText(
    [
      "Rencana Kerja Hari Ini",
      "- Menyusun laporan penjualan mingguan",
      "2. Menyiapkan materi meeting klien",
      "• Menyusun laporan penjualan mingguan",
    ].join("\n"),
  );

  const mobile = await extract(
    "/api/mobile/work-plans/extract-from-image",
    tenant.ownerToken,
    png,
    "image/png",
    "rencana.png",
  );
  assert.equal(mobile.response.status, 200, JSON.stringify(mobile.body));
  assert.deepEqual(mobile.body, {
    items: [
      "Menyusun laporan penjualan mingguan",
      "Menyiapkan materi meeting klien",
    ],
    source: "ocr",
  });

  const alias = await extract(
    "/api/work-plans/extract-from-image",
    tenant.ownerToken,
    png,
    "image/png",
    "rencana.png",
  );
  assert.equal(alias.response.status, 200, JSON.stringify(alias.body));
  assert.deepEqual(alias.body.items, mobile.body.items);

  const anonymous = await extract(
    "/api/mobile/work-plans/extract-from-image",
    null,
    png,
    "image/png",
    "rencana.png",
  );
  assert.equal(anonymous.response.status, 401);

  const wrongType = await extract(
    "/api/mobile/work-plans/extract-from-image",
    tenant.ownerToken,
    Buffer.from("halo"),
    "text/plain",
    "catatan.txt",
  );
  assert.equal(wrongType.response.status, 400);
  assert.equal(wrongType.body.error.code, "INVALID_IMAGE_TYPE");

  const missing = await (async () => {
    const form = new FormData();
    form.set("note", "tanpa gambar");
    const response = await fetch(
      `${baseUrl}/api/mobile/work-plans/extract-from-image`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${tenant.ownerToken}`,
          connection: "close",
        },
        body: form,
      },
    );
    return { response, body: await response.json().catch(() => ({})) };
  })();
  assert.equal(missing.response.status, 400);
  assert.equal(missing.body.error.code, "IMAGE_REQUIRED");
});
