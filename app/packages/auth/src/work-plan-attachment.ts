import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { isUuid, withTenant, type TenantContext } from "@absensi/database";

import { HttpError } from "./http.js";

export const MAX_WORK_PLAN_ATTACHMENT_BYTES = 5 * 1024 * 1024;
export const WORK_PLAN_ATTACHMENT_URL_PREFIX = "/api/work-plans/";

export type WorkPlanAttachmentInput = {
  bytes: Uint8Array;
  contentType: string;
  filename: string;
};

export type WorkPlanAttachmentFile = {
  bytes: Uint8Array;
  contentType: string;
  filename: string;
};

/** Lampiran rencana kerja tidak berada di public/; path dapat dioverride test. */
export function workPlanAttachmentDirectory(
  env: NodeJS.ProcessEnv = process.env,
): string {
  return env.WORK_PLAN_ATTACHMENT_DIR ?? join(process.cwd(), "storage", "work-plans");
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

/** Simpan gambar rencana kerja dengan nama file = id entitas (UUID). */
export async function storeWorkPlanAttachment(
  id: string,
  input: WorkPlanAttachmentInput,
): Promise<{ url: string; hash: string }> {
  if (!isUuid(id)) {
    throw new HttpError(400, "INVALID_ATTACHMENT", "Rencana kerja tidak valid");
  }
  if (
    input.bytes.byteLength === 0 ||
    input.bytes.byteLength > MAX_WORK_PLAN_ATTACHMENT_BYTES
  ) {
    throw new HttpError(400, "INVALID_ATTACHMENT", "Gambar rencana maksimal 5 MB");
  }
  const normalized = input.contentType.toLowerCase().split(";")[0]?.trim() ?? "";
  if (!/^image\/(jpeg|png|webp)$/.test(normalized)) {
    throw new HttpError(
      400,
      "INVALID_ATTACHMENT",
      "Gambar rencana harus JPEG, PNG, atau WebP",
    );
  }
  if (!detectImage(input.bytes)) {
    throw new HttpError(400, "INVALID_ATTACHMENT", "Isi file bukan gambar yang valid");
  }
  const directory = resolve(workPlanAttachmentDirectory());
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, id), input.bytes);
  return {
    url: `${WORK_PLAN_ATTACHMENT_URL_PREFIX}${id}/attachment`,
    hash: createHash("sha256").update(input.bytes).digest("hex"),
  };
}

async function readStoredAttachment(
  id: string,
  url: string | null,
): Promise<WorkPlanAttachmentFile> {
  if (!url || !url.startsWith(WORK_PLAN_ATTACHMENT_URL_PREFIX)) {
    throw new HttpError(404, "ATTACHMENT_NOT_FOUND", "Lampiran tidak ditemukan");
  }
  const directory = resolve(workPlanAttachmentDirectory());
  const path = resolve(join(directory, id));
  if (!path.startsWith(`${directory}/`)) {
    throw new HttpError(404, "ATTACHMENT_NOT_FOUND", "Lampiran tidak ditemukan");
  }
  let bytes: Uint8Array;
  try {
    bytes = await readFile(path);
  } catch {
    throw new HttpError(404, "ATTACHMENT_NOT_FOUND", "Lampiran tidak ditemukan");
  }
  const detected = detectImage(bytes);
  if (!detected) {
    throw new HttpError(404, "ATTACHMENT_NOT_FOUND", "Lampiran tidak ditemukan");
  }
  return {
    bytes,
    contentType: detected.contentType,
    filename: `${id}${detected.extension}`,
  };
}

function canReview(ctx: TenantContext): boolean {
  return (
    ctx.permissions.includes("correction.review") ||
    ctx.permissions.includes("attendance.read") ||
    ctx.permissions.includes("member.manage")
  );
}

export async function readWorkPlanAttachment(input: {
  ctx: TenantContext;
  planId: string;
}): Promise<WorkPlanAttachmentFile> {
  if (!isUuid(input.planId)) {
    throw new HttpError(404, "WORK_PLAN_NOT_FOUND", "Rencana kerja tidak ditemukan");
  }
  const record = await withTenant(input.ctx, (db) =>
    db.workPlan.findFirst({
      where: { id: input.planId },
      select: { memberId: true, planAttachmentUrl: true },
    }),
  );
  if (!record) {
    throw new HttpError(404, "WORK_PLAN_NOT_FOUND", "Rencana kerja tidak ditemukan");
  }
  if (record.memberId !== input.ctx.memberId && !canReview(input.ctx)) {
    throw new HttpError(403, "ATTACHMENT_FORBIDDEN", "Lampiran tidak dapat diakses");
  }
  return readStoredAttachment(input.planId, record.planAttachmentUrl);
}

export async function readWfhRequestPlanAttachment(input: {
  ctx: TenantContext;
  requestId: string;
}): Promise<WorkPlanAttachmentFile> {
  if (!isUuid(input.requestId)) {
    throw new HttpError(404, "WFH_NOT_FOUND", "Pengajuan WFH tidak ditemukan");
  }
  const record = await withTenant(input.ctx, (db) =>
    db.wfhRequest.findFirst({
      where: { id: input.requestId },
      select: { memberId: true, planAttachmentUrl: true },
    }),
  );
  if (!record) {
    throw new HttpError(404, "WFH_NOT_FOUND", "Pengajuan WFH tidak ditemukan");
  }
  if (record.memberId !== input.ctx.memberId && !canReview(input.ctx)) {
    throw new HttpError(403, "ATTACHMENT_FORBIDDEN", "Lampiran tidak dapat diakses");
  }
  return readStoredAttachment(input.requestId, record.planAttachmentUrl);
}
