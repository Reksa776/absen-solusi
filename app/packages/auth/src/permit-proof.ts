import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";

import { isUuid, systemDb, withTenant, type TenantContext } from "@absensi/database";

import { HttpError } from "./http.js";

export const MAX_PERMIT_PROOF_BYTES = 5 * 1024 * 1024;
const CONTENT_TYPES: Record<string, { extension: string; mime: string }> = {
  "image/jpeg": { extension: "jpg", mime: "image/jpeg" },
  "image/png": { extension: "png", mime: "image/png" },
  "image/webp": { extension: "webp", mime: "image/webp" },
  "application/pdf": { extension: "pdf", mime: "application/pdf" },
};
const FILE_PATTERN = /^[0-9a-f-]{36}\.(jpg|png|webp|pdf)$/;

export type PermitProofInput = {
  bytes: Uint8Array;
  contentType: string;
  filename: string;
};

export type PermitProofFile = {
  bytes: Uint8Array;
  contentType: string;
  filename: string;
};

export function permitProofDirectory(): string {
  return process.env.PERMIT_PROOF_DIR ?? join(process.cwd(), "storage", "permits");
}

function validContentType(value: string): { extension: string; mime: string } {
  const normalized = value.toLowerCase().split(";")[0]?.trim() ?? "";
  const type = CONTENT_TYPES[normalized];
  if (!type) {
    throw new HttpError(
      400,
      "INVALID_PROOF",
      "Bukti izin harus berupa JPEG, PNG, WebP, atau PDF",
    );
  }
  return type;
}

export async function storePermitProof(
  id: string,
  proof: PermitProofInput,
): Promise<{ proofHash: string; proofFileName: string; proofContentType: string }> {
  if (proof.bytes.byteLength === 0 || proof.bytes.byteLength > MAX_PERMIT_PROOF_BYTES) {
    throw new HttpError(400, "INVALID_PROOF", "Bukti izin maksimal 5 MB");
  }
  const type = validContentType(proof.contentType);
  const filename = `${id}.${type.extension}`;
  const directory = resolve(permitProofDirectory());
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, filename), proof.bytes);
  return {
    proofHash: createHash("sha256").update(proof.bytes).digest("hex"),
    proofFileName: filename,
    proofContentType: type.mime,
  };
}

/**
 * Bukti hanya dapat dibaca oleh pemilik izin atau reviewer tenant yang sama.
 * Nama file berasal dari kolom proof_file_name yang sudah divalidasi pola.
 */
export async function readPermitProof(input: {
  ctx: TenantContext;
  permitId: string;
}): Promise<PermitProofFile> {
  if (!isUuid(input.permitId)) {
    throw new HttpError(404, "PERMIT_NOT_FOUND", "Izin kerja tidak ditemukan");
  }
  const record = await withTenant(input.ctx, (db) =>
    db.workPermit.findFirst({
      where: { id: input.permitId },
      select: {
        memberId: true,
        proofFileName: true,
        proofContentType: true,
      },
    }),
  );
  if (!record) {
    const exists = await systemDb().workPermit.findUnique({
      where: { id: input.permitId },
      select: { id: true },
    });
    if (exists) {
      throw new HttpError(403, "PROOF_FORBIDDEN", "Bukti tidak dapat diakses");
    }
    throw new HttpError(404, "PERMIT_NOT_FOUND", "Izin kerja tidak ditemukan");
  }

  const canReview =
    input.ctx.permissions.includes("correction.review") ||
    input.ctx.permissions.includes("member.manage") ||
    input.ctx.roleKeys.includes("WORKSPACE_OWNER") ||
    input.ctx.roleKeys.includes("WORKSPACE_ADMIN") ||
    input.ctx.roleKeys.includes("HR");
  if (record.memberId !== input.ctx.memberId && !canReview) {
    throw new HttpError(403, "PROOF_FORBIDDEN", "Bukti tidak dapat diakses");
  }
  if (!record.proofFileName || !FILE_PATTERN.test(record.proofFileName)) {
    throw new HttpError(404, "PROOF_NOT_FOUND", "Bukti tidak ditemukan");
  }

  const directory = resolve(permitProofDirectory());
  const path = resolve(join(directory, basename(record.proofFileName)));
  if (!path.startsWith(`${directory}/`)) {
    throw new HttpError(404, "PROOF_NOT_FOUND", "Bukti tidak ditemukan");
  }
  const extension = record.proofFileName.slice(record.proofFileName.lastIndexOf(".") + 1);
  const mime =
    record.proofContentType ??
    CONTENT_TYPES[`image/${extension}`]?.mime ??
    (extension === "pdf" ? "application/pdf" : "application/octet-stream");
  try {
    return {
      bytes: await readFile(path),
      contentType: mime,
      filename: record.proofFileName,
    };
  } catch {
    throw new HttpError(404, "PROOF_NOT_FOUND", "Bukti tidak ditemukan");
  }
}

export function newPermitId(): string {
  return randomUUID();
}
