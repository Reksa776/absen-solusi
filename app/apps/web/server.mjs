import {
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { dirname, join, resolve } from "node:path";

import {
  getClientIp,
  HttpError,
  logger,
  requirePermission,
} from "@absensi/auth";
import { writeAudit } from "@absensi/database";
import Busboy from "busboy";
import next from "next";

const port = Number(process.env.PORT ?? 3000);
const hostname = process.env.HOSTNAME ?? "0.0.0.0";
const APK_FILENAME = "absensi-mobile.apk";
const VERSION_FILENAME = "version.json";
const MAX_APK_BYTES = 300 * 1024 * 1024;
const APP_RELEASE_PATTERN =
  /^\/api\/workspaces\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/app-release$/i;
// Katalog role aplikasi memakai "HR" (setara HR_ADMIN pada spesifikasi);
// permission `workspace.manage` tetap menjadi penentu akhir.
const UPLOAD_ROLES = new Set(["WORKSPACE_OWNER", "HR"]);

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

function sendJson(response, status, payload) {
  if (response.writableEnded) return;
  const body = JSON.stringify(payload);
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": String(Buffer.byteLength(body)),
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  response.end(body);
}

function sendError(response, error) {
  const status = error instanceof HttpError ? error.status : 500;
  const code = error instanceof HttpError ? error.code : "INTERNAL_ERROR";
  const message =
    error instanceof HttpError ? error.message : "Terjadi kesalahan internal";
  if (!(error instanceof HttpError)) {
    logger.error("mobile release upload failed", { error });
  }
  sendJson(response, status, { error: { code, message } });
}

/** Request auth hanya butuh method + headers; body tetap dipegang stream asli. */
function toFetchRequest(request) {
  const headers = new Headers();
  for (const [name, value] of Object.entries(request.headers)) {
    if (name === "content-length" || name === "transfer-encoding") continue;
    if (Array.isArray(value)) headers.set(name, value.join(", "));
    else if (typeof value === "string") headers.set(name, value);
  }
  return new Request(`http://127.0.0.1${request.url ?? "/"}`, {
    method: request.method,
    headers,
  });
}

/**
 * Parse multipart langsung dari stream ke berkas sementara, tanpa menahan
 * 300 MB di memori. Middleware/proxy Next.js tidak pernah melihat body ini.
 */
function parseMultipart(request, temporaryPath) {
  return new Promise((resolvePromise, rejectPromise) => {
    let busboy;
    try {
      busboy = Busboy({
        headers: request.headers,
        limits: {
          files: 1,
          fileSize: MAX_APK_BYTES,
          fields: 20,
          fieldSize: 4096,
          parts: 30,
        },
      });
    } catch {
      rejectPromise(
        new HttpError(400, "INVALID_MULTIPART", "Body harus multipart/form-data."),
      );
      return;
    }

    const fields = new Map();
    let filename = "";
    let size = 0;
    let settled = false;
    let fileStream = null;
    let fileDone = Promise.resolve();

    const fail = (error) => {
      if (settled) return;
      settled = true;
      fileStream?.destroy();
      request.unpipe(busboy);
      request.resume();
      rejectPromise(error);
    };

    busboy.on("file", (name, stream, info) => {
      if (name !== "apk" || fileStream) {
        stream.resume();
        return;
      }
      filename = info.filename ?? "";
      fileStream = createWriteStream(temporaryPath);
      fileDone = new Promise((done, failed) => {
        fileStream.on("close", done);
        fileStream.on("error", failed);
      });
      stream.on("data", (chunk) => {
        size += chunk.length;
      });
      stream.on("limit", () =>
        fail(
          new HttpError(413, "APK_TOO_LARGE", "Ukuran APK melebihi 300 MB."),
        ),
      );
      stream.on("error", fail);
      stream.pipe(fileStream);
    });

    busboy.on("field", (name, value) => {
      if (fields.size < 20) fields.set(name, value);
    });
    busboy.on("error", () =>
      fail(
        new HttpError(400, "INVALID_MULTIPART", "Body multipart tidak valid."),
      ),
    );
    busboy.on("close", () => {
      if (settled) return;
      fileDone
        .then(() => {
          if (settled) return;
          settled = true;
          resolvePromise({
            fields: Object.fromEntries(fields),
            filename,
            size,
            temporaryPath,
          });
        })
        .catch(fail);
    });
    request.on("aborted", () =>
      fail(new HttpError(400, "REQUEST_ABORTED", "Unggahan dibatalkan.")),
    );
    request.pipe(busboy);
  });
}

function writeVersionFile(version) {
  mkdirSync(releaseDirectory(), { recursive: true });
  const target = join(releaseDirectory(), VERSION_FILENAME);
  const temporary = `${target}.${randomUUID()}.tmp`;
  writeFileSync(temporary, JSON.stringify(version, null, 2), "utf8");
  renameSync(temporary, target);
}

async function handleAppRelease(request, response, workspaceId) {
  let temporaryPath = null;
  try {
    const authRequest = toFetchRequest(request);
    const authenticated = await requirePermission(authRequest, "workspace.manage");
    if (authenticated.mode !== "cookie") {
      throw new HttpError(
        401,
        "UNAUTHENTICATED",
        "Unggahan APK memerlukan sesi cookie.",
      );
    }
    const { ctx } = authenticated;
    if (ctx.tenantId !== workspaceId) {
      throw new HttpError(
        403,
        "WORKSPACE_FORBIDDEN",
        "Workspace tidak tersedia untuk akun ini.",
      );
    }
    if (!ctx.roleKeys.some((role) => UPLOAD_ROLES.has(role))) {
      throw new HttpError(
        403,
        "FORBIDDEN",
        "Hanya owner atau HR admin yang dapat mengunggah rilis.",
      );
    }

    const directory = releaseDirectory();
    mkdirSync(directory, { recursive: true });
    temporaryPath = join(directory, `.apk-upload-${randomUUID()}.tmp`);

    const parsed = await parseMultipart(request, temporaryPath);
    temporaryPath = parsed.temporaryPath;

    if (!parsed.filename || parsed.size === 0) {
      throw new HttpError(400, "APK_REQUIRED", "Pilih berkas APK rilis.");
    }
    if (!parsed.filename.toLowerCase().endsWith(".apk")) {
      throw new HttpError(400, "INVALID_APK", "Berkas harus berekstensi .apk.");
    }
    if (parsed.size > MAX_APK_BYTES) {
      throw new HttpError(413, "APK_TOO_LARGE", "Ukuran APK melebihi 300 MB.");
    }

    const latestVersion = String(parsed.fields.latestVersion ?? "").trim();
    if (!/^\d+\.\d+\.\d+$/.test(latestVersion)) {
      throw new HttpError(
        400,
        "INVALID_VERSION",
        "Format versi harus x.y.z, misalnya 1.2.0.",
      );
    }
    const buildNumber = Number(String(parsed.fields.buildNumber ?? "").trim());
    if (!Number.isInteger(buildNumber) || buildNumber < 1) {
      throw new HttpError(
        400,
        "INVALID_BUILD_NUMBER",
        "Build number harus bilangan bulat minimal 1.",
      );
    }
    const changelog = String(parsed.fields.changelog ?? "").slice(0, 4000);
    const forceUpdate = ["1", "true", "on"].includes(
      String(parsed.fields.forceUpdate ?? "").toLowerCase(),
    );

    // renameSync dalam direktori yang sama bersifat atomik: pembaca tidak
    // pernah melihat APK setengah tertulis.
    renameSync(temporaryPath, join(directory, APK_FILENAME));
    temporaryPath = null;

    const version = {
      latestVersion,
      buildNumber,
      forceUpdate,
      changelog,
      downloadUrl: "/api/mobile/apk/latest",
    };
    writeVersionFile(version);

    try {
      await writeAudit({
        tenantId: ctx.tenantId,
        actorType: "USER",
        actorUserId: ctx.userId,
        actorMemberId: ctx.memberId,
        action: "mobile.release_upload",
        resourceType: "mobile_release",
        resourceId: ctx.tenantId,
        metadata: {
          latestVersion,
          buildNumber,
          forceUpdate,
          sizeBytes: parsed.size,
        },
        ip: getClientIp(authRequest, request.socket?.remoteAddress),
        userAgent: request.headers["user-agent"] ?? null,
      });
    } catch (error) {
      // Unggahan sudah tersimpan; audit dicatat sebagai kegagalan operasional.
      logger.error("mobile release audit failed", { error });
    }

    sendJson(response, 201, {
      version,
      apk: { filename: APK_FILENAME, sizeBytes: parsed.size },
    });
  } catch (error) {
    if (temporaryPath) {
      try {
        unlinkSync(temporaryPath);
      } catch {
        // Berkas sementara mungkin sudah dipindahkan/dihapus.
      }
    }
    if (response.writableEnded) {
      // Header sudah dikirim; tidak ada respons tambahan yang aman.
      logger.error("mobile release response already ended", { error });
      return;
    }
    request.resume();
    sendError(response, error);
  }
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
  const releaseMatch = pathname.match(APP_RELEASE_PATTERN);
  if (releaseMatch && request.method === "POST") {
    handleAppRelease(request, response, releaseMatch[1]).catch((error) => {
      logger.error("mobile release handler crashed", { error });
      sendError(response, error);
    });
    return;
  }
  handle(request, response);
});

server.listen(port, hostname, () => {
  console.log(`> Absensi web siap di http://${hostname}:${port}`);
});
