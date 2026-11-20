import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, join, resolve } from "node:path";

import next from "next";

const port = Number(process.env.PORT ?? 3000);
const hostname = process.env.HOSTNAME ?? "0.0.0.0";
const APK_FILENAME = "absensi-mobile.apk";

function releaseDirectory() {
  const configured = process.env.MOBILE_RELEASE_DIR?.trim();
  if (configured) return resolve(configured);
  const candidates = [
    resolve(process.cwd(), "storage", "releases"),
    resolve(process.cwd(), "..", "..", "storage", "releases"),
  ];
  for (const candidate of candidates) {
    if (existsSync(dirname(candidate))) return candidate;
  }
  return candidates[0];
}

/**
 * Next.js membuang header `content-length` dari semua respons route handler
 * (lihat FORBIDDEN_HEADERS di next/dist/server/send-response.js). Supaya
 * unduhan APK punya panjang pasti untuk progress bar di aplikasi, endpoint ini
 * ditangani langsung oleh server HTTP dengan streaming file.
 */
function serveApk(request, response) {
  const path = join(releaseDirectory(), APK_FILENAME);
  let stats = null;
  try {
    stats = statSync(path);
  } catch {
    stats = null;
  }

  if (!stats?.isFile()) {
    const body = JSON.stringify({
      error: {
        code: "APK_NOT_FOUND",
        message: "Belum ada berkas APK rilis yang diunggah.",
      },
    });
    response.writeHead(404, {
      "content-type": "application/json; charset=utf-8",
      "content-length": String(Buffer.byteLength(body)),
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    });
    response.end(request.method === "HEAD" ? undefined : body);
    return;
  }

  response.writeHead(200, {
    "content-type": "application/vnd.android.package-archive",
    "content-disposition": `attachment; filename="${APK_FILENAME}"`,
    "content-length": String(stats.size),
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "referrer-policy": "strict-origin-when-cross-origin",
  });
  if (request.method === "HEAD") {
    response.end();
    return;
  }
  createReadStream(path)
    .on("error", () => response.destroy())
    .pipe(response);
}

const app = next({ dev: false, dir: process.cwd() });
await app.prepare();
const handle = app.getRequestHandler();

const server = createServer((request, response) => {
  const pathname = (request.url ?? "/").split("?")[0];
  if (
    pathname === "/api/mobile/apk/latest" &&
    (request.method === "GET" || request.method === "HEAD")
  ) {
    serveApk(request, response);
    return;
  }
  handle(request, response);
});

server.listen(port, hostname, () => {
  console.log(`> Absensi web siap di http://${hostname}:${port}`);
});
