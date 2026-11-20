import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { request } from "@playwright/test";

const here = dirname(fileURLToPath(import.meta.url));
const authDir = join(here, ".auth");
const port = Number(process.env.E2E_PORT ?? 3943);
const baseURL = process.env.E2E_BASE_URL ?? `https://127.0.0.1:${port}`;

function ensureCertificate() {
  const key = join(authDir, "key.pem");
  const cert = join(authDir, "cert.pem");
  if (existsSync(key) && existsSync(cert)) return;
  execFileSync("openssl", [
    "req",
    "-x509",
    "-newkey",
    "rsa:2048",
    "-nodes",
    "-keyout",
    key,
    "-out",
    cert,
    "-days",
    "1",
    "-subj",
    "/CN=127.0.0.1",
  ]);
}

export default async function globalSetup() {
  mkdirSync(authDir, { recursive: true });
  ensureCertificate();

  const server = spawn(process.execPath, [join(here, "server.mjs")], {
    cwd: join(here, ".."),
    env: {
      ...process.env,
      E2E_PORT: String(port),
      S1_RATE_LIMITER: "memory",
      ALLOW_REGISTRATION: "true",
      EMAIL_TRANSPORT: "memory",
      PUSH_TRANSPORT: "memory",
    },
    stdio: ["ignore", "ignore", "inherit"],
    detached: true,
  });
  server.unref();
  writeFileSync(join(authDir, "server.pid"), String(server.pid));

  // Sertifikat lokal; hanya untuk proses setup test ini.
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
  const deadline = Date.now() + 120_000;
  let ready = false;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseURL}/sign-in`);
      if (response.ok) {
        ready = true;
        break;
      }
    } catch {
      // server belum listen
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  if (!ready) throw new Error("Server E2E tidak siap dalam 120 detik");

  const api = await request.newContext({ baseURL, ignoreHTTPSErrors: true });
  try {
    const csrfResponse = await api.get("/api/auth/csrf");
    const { csrfToken } = await csrfResponse.json();
    const email = `e2e-${Date.now()}@example.com`;
    const password = "RahasiaSekali123!";
    const response = await api.post("/api/auth/register", {
      headers: { "x-csrf-token": csrfToken },
      data: { email, password, name: "E2E User", workspaceName: "E2E Workspace" },
    });
    if (response.status() !== 201) {
      throw new Error(`Register E2E gagal ${response.status()}: ${await response.text()}`);
    }

    // Register mengembalikan token; sesi cookie dibuat lewat login.
    const loginCsrf = await (await api.get("/api/auth/csrf")).json();
    const login = await api.post("/api/auth/login", {
      headers: { "x-csrf-token": loginCsrf.csrfToken },
      data: { email, password },
    });
    if (login.status() !== 200) {
      throw new Error(`Login E2E gagal ${login.status()}: ${await login.text()}`);
    }
    const state = await api.storageState();
    if (!state.cookies.some((cookie) => cookie.name.includes("aos_session"))) {
      throw new Error("Cookie sesi tidak tersimpan pada storage state E2E");
    }
    const profile = await (await api.get("/api/auth/me")).json();
    if (!profile.activeTenantId) {
      throw new Error(`Profil E2E tanpa activeTenantId: ${JSON.stringify(profile)}`);
    }
    await api.storageState({ path: join(authDir, "state.json") });
    writeFileSync(
      join(authDir, "session.json"),
      JSON.stringify({ tenantId: profile.activeTenantId, email, password }),
    );
  } finally {
    await api.dispose();
  }
}
