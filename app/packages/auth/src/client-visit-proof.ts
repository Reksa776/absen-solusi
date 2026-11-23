import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";

import { isUuid, withTenant, type TenantContext, systemDb } from "@absensi/database";

import { HttpError } from "./http.js";

export const MAX_CLIENT_VISIT_PHOTO_BYTES = 5 * 1024 * 1024;

const CONTENT_TYPES: Record<string, { extension: string; mime: string }> = {
  "image/jpeg": { extension: "jpg", mime: "image/jpeg" },
  "image/png": { extension: "png", mime: "image/png" },
  "image/webp": { extension: "webp", mime: "image/webp" },
};
const FILE_PATTERN = /^[0-9a-f-]{36}\.(jpg|png|webp)$/;

export type ClientVisitPhotoInput = {
  bytes: Uint8Array;
  contentType: string;
  filename: string;
};

export type ClientVisitPhotoFile = {
  bytes: Uint8Array;
  contentType: string;
  filename: string;
};

export function clientVisitPhotoDirectory(): string {
  return (
    process.env.CLIENT_VISIT_PHOTO_DIR ??
    join(process.cwd(), "storage", "client-visits")
  );
}

function validContentType(value: string): { extension: string; mime: string } {
  const normalized = value.toLowerCase().split(";")[0]?.trim() ?? "";
  const type = CONTENT_TYPES[normalized];
  if (!type) {
    throw new HttpError(
      400,
      "INVALID_CLIENT_VISIT_PHOTO",
      "Foto kunjungan harus berupa JPEG, PNG, atau WebP",
    );
  }
  return type;
}

export async function storeClientVisitPhoto(
  logId: string,
  photo: ClientVisitPhotoInput,
): Promise<{ photoHash: string; photoFileName: string; photoContentType: string }> {
  if (
    photo.bytes.byteLength === 0 ||
    photo.bytes.byteLength > MAX_CLIENT_VISIT_PHOTO_BYTES
  ) {
    throw new HttpError(
      400,
      "INVALID_CLIENT_VISIT_PHOTO",
      "Foto kunjungan maksimal 5 MB",
    );
  }
  const type = validContentType(photo.contentType);
  const fileName = `${logId}.${type.extension}`;
  const directory = resolve(clientVisitPhotoDirectory());
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, fileName), photo.bytes);
  return {
    photoHash: createHash("sha256").update(photo.bytes).digest("hex"),
    photoFileName: fileName,
    photoContentType: type.mime,
  };
}

export async function readClientVisitPhoto(input: {
  ctx: TenantContext;
  logId: string;
}): Promise<ClientVisitPhotoFile> {
  if (!isUuid(input.logId)) {
    throw new HttpError(404, "CLIENT_VISIT_NOT_FOUND", "Kunjungan tidak ditemukan");
  }
  const record = await withTenant(input.ctx, (db) =>
    db.clientVisitLog.findFirst({
      where: { id: input.logId },
      select: {
        memberId: true,
        photoFileName: true,
        photoContentType: true,
      },
    }),
  );
  if (!record) {
    const exists = await systemDb().clientVisitLog.findUnique({
      where: { id: input.logId },
      select: { id: true },
    });
    if (exists) {
      throw new HttpError(403, "CLIENT_VISIT_PHOTO_FORBIDDEN", "Foto tidak dapat diakses");
    }
    throw new HttpError(404, "CLIENT_VISIT_NOT_FOUND", "Kunjungan tidak ditemukan");
  }
  const canReview =
    input.ctx.permissions.includes("attendance.read") ||
    input.ctx.permissions.includes("member.manage") ||
    input.ctx.roleKeys.includes("WORKSPACE_OWNER") ||
    input.ctx.roleKeys.includes("WORKSPACE_ADMIN");
  if (record.memberId !== input.ctx.memberId && !canReview) {
    throw new HttpError(403, "CLIENT_VISIT_PHOTO_FORBIDDEN", "Foto tidak dapat diakses");
  }
  if (!record.photoFileName || !FILE_PATTERN.test(record.photoFileName)) {
    throw new HttpError(404, "CLIENT_VISIT_PHOTO_NOT_FOUND", "Foto tidak ditemukan");
  }
  const directory = resolve(clientVisitPhotoDirectory());
  const path = resolve(join(directory, basename(record.photoFileName)));
  if (!path.startsWith(`${directory}/`)) {
    throw new HttpError(404, "CLIENT_VISIT_PHOTO_NOT_FOUND", "Foto tidak ditemukan");
  }
  try {
    return {
      bytes: await readFile(path),
      contentType: record.photoContentType ?? "application/octet-stream",
      filename: record.photoFileName,
    };
  } catch {
    throw new HttpError(404, "CLIENT_VISIT_PHOTO_NOT_FOUND", "Foto tidak ditemukan");
  }
}
