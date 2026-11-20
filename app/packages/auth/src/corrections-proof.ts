import { readFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";

import { isUuid, systemDb, withTenant, type TenantContext } from "@absensi/database";

import { PROOF_URL_PREFIX, proofDirectory } from "./corrections.js";
import { HttpError } from "./http.js";

export const PROOF_FILE_PATTERN = /^[0-9a-f-]{36}\.(jpg|png|webp|pdf)$/;
export const PROOF_CONTENT_TYPES: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".pdf": "application/pdf",
};

export type CorrectionProofFile = {
  bytes: Uint8Array;
  contentType: string;
  filename: string;
};

/**
 * Bukti hanya dapat dibaca oleh pemilik revisi atau reviewer tenant yang sama.
 * Nama file diambil dari proof_url tersimpan dan divalidasi pola UUID+ekstensi,
 * sehingga path traversal tidak mungkin dipakai.
 */
export async function readCorrectionProof(input: {
  ctx: TenantContext;
  correctionId: string;
}): Promise<CorrectionProofFile> {
  if (!isUuid(input.correctionId)) {
    throw new HttpError(404, "CORRECTION_NOT_FOUND", "Revisi tidak ditemukan");
  }
  const record = await withTenant(input.ctx, (db) =>
    db.correctionRequest.findFirst({
      where: { id: input.correctionId },
      select: { memberId: true, proofUrl: true },
    }),
  );
  if (!record) {
    // SYSTEM: cek keberadaan lintas tenant tanpa membaca data, semata-mata agar
    // revisi tenant asing menghasilkan 403 yang identik dengan penolakan izin
    // dan tidak membocorkan isi. Revisi yang benar-benar tidak ada tetap 404.
    const exists = await systemDb().correctionRequest.findUnique({
      where: { id: input.correctionId },
      select: { id: true },
    });
    if (exists) {
      throw new HttpError(403, "PROOF_FORBIDDEN", "Bukti tidak dapat diakses");
    }
    throw new HttpError(404, "CORRECTION_NOT_FOUND", "Revisi tidak ditemukan");
  }

  const canReviewAll =
    input.ctx.permissions.includes("correction.read") ||
    input.ctx.permissions.includes("correction.review") ||
    input.ctx.roleKeys.includes("WORKSPACE_OWNER") ||
    input.ctx.roleKeys.includes("WORKSPACE_ADMIN");
  if (record.memberId !== input.ctx.memberId && !canReviewAll) {
    throw new HttpError(403, "PROOF_FORBIDDEN", "Bukti tidak dapat diakses");
  }
  if (!record.proofUrl || !record.proofUrl.startsWith(PROOF_URL_PREFIX)) {
    throw new HttpError(404, "PROOF_NOT_FOUND", "Bukti tidak ditemukan");
  }

  const filename = basename(record.proofUrl);
  if (!PROOF_FILE_PATTERN.test(filename)) {
    throw new HttpError(404, "PROOF_NOT_FOUND", "Bukti tidak ditemukan");
  }
  const directory = resolve(proofDirectory());
  const path = resolve(join(directory, filename));
  if (!path.startsWith(`${directory}/`)) {
    throw new HttpError(404, "PROOF_NOT_FOUND", "Bukti tidak ditemukan");
  }
  const extension = filename.slice(filename.lastIndexOf("."));
  const contentType = PROOF_CONTENT_TYPES[extension];
  if (!contentType) {
    throw new HttpError(404, "PROOF_NOT_FOUND", "Bukti tidak ditemukan");
  }

  try {
    const bytes = await readFile(path);
    return { bytes, contentType, filename };
  } catch {
    throw new HttpError(404, "PROOF_NOT_FOUND", "Bukti tidak ditemukan");
  }
}
