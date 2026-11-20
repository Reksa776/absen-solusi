import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { isUuid, systemDb, withTenant, type TenantContext } from "@absensi/database";

import { ATTENDANCE_PHOTO_URL_PREFIX } from "./attendance.js";
import { HttpError } from "./http.js";

export const ATTENDANCE_PHOTO_FILE_PATTERN = /^[0-9a-f-]{36}$/;

export type AttendancePhotoFile = {
  bytes: Uint8Array;
  contentType: string;
  filename: string;
};

/** Foto tidak pernah berada di public/; path dapat dioverride untuk test. */
export function attendancePhotoDirectory(env: NodeJS.ProcessEnv = process.env): string {
  return env.ATTENDANCE_PHOTO_DIR ?? join(process.cwd(), "storage", "attendance");
}

function detectImage(bytes: Uint8Array): { contentType: string; extension: string } | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return { contentType: "image/jpeg", extension: ".jpg" };
  }
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return { contentType: "image/png", extension: ".png" };
  }
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return { contentType: "image/webp", extension: ".webp" };
  }
  return null;
}

/**
 * Foto hanya dapat dibaca pemilik absensi atau member dengan attendance.read.
 * Nama file berasal dari id absensi yang tervalidasi UUID, sehingga path
 * traversal tidak mungkin dipakai.
 */
export async function readAttendancePhoto(input: {
  ctx: TenantContext;
  attendanceId: string;
}): Promise<AttendancePhotoFile> {
  if (!isUuid(input.attendanceId)) {
    throw new HttpError(404, "ATTENDANCE_NOT_FOUND", "Absensi tidak ditemukan");
  }

  const record = await withTenant(input.ctx, (db) =>
    db.attendanceLog.findFirst({
      where: { id: input.attendanceId },
      select: { memberId: true, photoUrl: true },
    }),
  );
  if (!record) {
    // SYSTEM: hanya cek keberadaan lintas tenant untuk membedakan 403 vs 404
    // tanpa membaca isi absensi.
    const exists = await systemDb().attendanceLog.findUnique({
      where: { id: input.attendanceId },
      select: { id: true },
    });
    if (exists) {
      throw new HttpError(403, "ATTENDANCE_PHOTO_FORBIDDEN", "Foto tidak dapat diakses");
    }
    throw new HttpError(404, "ATTENDANCE_NOT_FOUND", "Absensi tidak ditemukan");
  }

  const canReadAll = input.ctx.permissions.includes("attendance.read");
  if (record.memberId !== input.ctx.memberId && !canReadAll) {
    throw new HttpError(403, "ATTENDANCE_PHOTO_FORBIDDEN", "Foto tidak dapat diakses");
  }
  if (!record.photoUrl.startsWith(ATTENDANCE_PHOTO_URL_PREFIX)) {
    throw new HttpError(404, "ATTENDANCE_PHOTO_NOT_FOUND", "Foto tidak ditemukan");
  }

  const directory = resolve(attendancePhotoDirectory());
  const path = resolve(join(directory, input.attendanceId));
  if (!path.startsWith(`${directory}/`)) {
    throw new HttpError(404, "ATTENDANCE_PHOTO_NOT_FOUND", "Foto tidak ditemukan");
  }

  let bytes: Uint8Array;
  try {
    bytes = await readFile(path);
  } catch {
    throw new HttpError(404, "ATTENDANCE_PHOTO_NOT_FOUND", "Foto tidak ditemukan");
  }
  const detected = detectImage(bytes);
  if (!detected) {
    throw new HttpError(404, "ATTENDANCE_PHOTO_NOT_FOUND", "Foto tidak ditemukan");
  }
  return {
    bytes,
    contentType: detected.contentType,
    filename: `${input.attendanceId}${detected.extension}`,
  };
}
