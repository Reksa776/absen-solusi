import { createHash, randomUUID } from "node:crypto";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";

import {
  isUuid,
  withTenant,
  writeAudit,
  type Prisma,
  type TenantContext,
} from "@absensi/database";

import { HttpError } from "./http.js";
import { createInAppNotification } from "./inbox.js";
import { assertWorkspaceReadClaim } from "./workspaces.js";

export const REVISION_WINDOW_DAYS_DEFAULT = 7;
export const REVISION_MONTHLY_LIMIT_DEFAULT = 1;
export const CORRECTION_REASON_MIN_LENGTH = 10;
export const CORRECTION_REASON_MAX_LENGTH = 1000;
export const MAX_PROOF_BYTES = 5 * 1024 * 1024;
export const CORRECTION_LIST_DEFAULT_LIMIT = 50;
export const CORRECTION_LIST_MAX_LIMIT = 100;
/** Bukti tidak pernah disajikan dari direktori publik; akses lewat API. */
export const PROOF_URL_PREFIX = "/uploads/proofs/";

export const CORRECTION_TYPES = ["CHECK_IN", "CHECK_OUT"] as const;
export const CORRECTION_STATUSES = ["PENDING", "APPROVED", "REJECTED"] as const;

export type CorrectionType = (typeof CORRECTION_TYPES)[number];
export type CorrectionStatus = (typeof CORRECTION_STATUSES)[number];

export type CorrectionProof = {
  bytes: Uint8Array;
  filename: string;
  contentType: string;
};

function positiveEnvInt(name: string, fallback: number): number {
  const parsed = Number(process.env[name] ?? "");
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

/** Dibaca per request agar konfigurasi env dapat diubah tanpa restart modul. */
export function revisionWindowDays(): number {
  return positiveEnvInt("REVISION_WINDOW_DAYS", REVISION_WINDOW_DAYS_DEFAULT);
}

export function revisionMonthlyLimit(): number {
  return positiveEnvInt("REVISION_MONTHLY_LIMIT", REVISION_MONTHLY_LIMIT_DEFAULT);
}

function startOfUtcDay(value: Date): Date {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
}

function startOfUtcMonth(value: Date): Date {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), 1));
}

function endOfUtcMonth(value: Date): Date {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth() + 1, 1));
}

function parseRequestedTimestamp(value: string | Date): Date {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new HttpError(400, "INVALID_TIMESTAMP", "Timestamp revisi tidak valid");
  }
  return date;
}

function normalizeReason(value: string): string {
  const reason = value.trim();
  if (reason.length < CORRECTION_REASON_MIN_LENGTH) {
    throw new HttpError(
      400,
      "ALASAN_TOO_SHORT",
      `Alasan revisi minimal ${CORRECTION_REASON_MIN_LENGTH} karakter`,
    );
  }
  if (reason.length > CORRECTION_REASON_MAX_LENGTH) {
    throw new HttpError(400, "ALASAN_TOO_LONG", "Alasan revisi terlalu panjang");
  }
  return reason;
}

function normalizeRequestType(value: string): CorrectionType {
  if ((CORRECTION_TYPES as readonly string[]).includes(value)) {
    return value as CorrectionType;
  }
  throw new HttpError(400, "INVALID_REQUEST_TYPE", "Tipe revisi harus CHECK_IN atau CHECK_OUT");
}

export function normalizeStatus(value: string | undefined | null): CorrectionStatus | undefined {
  const status = value?.trim();
  if (!status) return undefined;
  if ((CORRECTION_STATUSES as readonly string[]).includes(status)) {
    return status as CorrectionStatus;
  }
  throw new HttpError(400, "INVALID_STATUS", "Status revisi tidak valid");
}

function parseDay(value: string, label: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new HttpError(400, "INVALID_DATE", `Parameter ${label} harus berformat YYYY-MM-DD`);
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) {
    throw new HttpError(400, "INVALID_DATE", `Parameter ${label} tidak valid`);
  }
  return date;
}

function timestampRange(from?: string | undefined, to?: string | undefined) {
  if (!from && !to) return undefined;
  const start = from ? parseDay(from, "from") : undefined;
  const end = to ? new Date(parseDay(to, "to").getTime() + 86_399_999) : undefined;
  if (start && end && start.getTime() > end.getTime()) {
    throw new HttpError(400, "INVALID_DATE_RANGE", "Rentang tanggal tidak valid");
  }
  return {
    ...(start ? { gte: start } : {}),
    ...(end ? { lte: end } : {}),
  };
}

/** Bukti tidak pernah disajikan dari direktori publik; akses lewat API. */
export function proofDirectory(env: NodeJS.ProcessEnv = process.env): string {
  return env.ATTENDANCE_PROOF_DIR ?? join(process.cwd(), "storage", "proofs");
}

async function storeProof(proof: CorrectionProof): Promise<{ url: string; hash: string; path: string }> {
  if (proof.bytes.byteLength === 0 || proof.bytes.byteLength > MAX_PROOF_BYTES) {
    throw new HttpError(400, "INVALID_PROOF", "Bukti wajib dan maksimal 5 MB");
  }
  const allowed: Record<string, string> = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "application/pdf": ".pdf",
  };
  const contentType = proof.contentType.split(";")[0]?.trim().toLowerCase() ?? "";
  const extension = allowed[contentType];
  if (!extension) {
    throw new HttpError(400, "INVALID_PROOF", "Bukti harus JPEG, PNG, WebP, atau PDF");
  }
  const dir = proofDirectory();
  await mkdir(dir, { recursive: true });
  const filename = `${randomUUID()}${extension}`;
  const path = join(dir, filename);
  await writeFile(path, proof.bytes);
  return {
    url: `${PROOF_URL_PREFIX}${filename}`,
    hash: createHash("sha256").update(proof.bytes).digest("hex"),
    path,
  };
}

type CorrectionRow = {
  id: string;
  tenantId: string;
  memberId: string;
  attendanceLogId: string | null;
  requestType: string;
  requestedTimestamp: Date;
  originalTimestamp: Date | null;
  reason: string;
  proofUrl: string | null;
  status: string;
  reviewedByMemberId: string | null;
  reviewedAt: Date | null;
  rejectionReason: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type CorrectionSummary = {
  id: string;
  memberId: string;
  attendanceLogId: string | null;
  requestType: CorrectionType;
  requestedTimestamp: string;
  originalTimestamp: string | null;
  reason: string;
  proofUrl: string | null;
  status: CorrectionStatus;
  reviewedByMemberId: string | null;
  reviewedAt: string | null;
  rejectionReason: string | null;
  createdAt: string;
  updatedAt: string;
};

function toSummary(row: CorrectionRow): CorrectionSummary {
  return {
    id: row.id,
    memberId: row.memberId,
    attendanceLogId: row.attendanceLogId,
    requestType: row.requestType as CorrectionType,
    requestedTimestamp: row.requestedTimestamp.toISOString(),
    originalTimestamp: row.originalTimestamp ? row.originalTimestamp.toISOString() : null,
    reason: row.reason,
    proofUrl: row.proofUrl,
    status: row.status as CorrectionStatus,
    reviewedByMemberId: row.reviewedByMemberId,
    reviewedAt: row.reviewedAt ? row.reviewedAt.toISOString() : null,
    rejectionReason: row.rejectionReason,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

type MemberRef = { id: string; user: { id: string; name: string; email: string } };

export type CorrectionAdminSummary = CorrectionSummary & {
  member: { id: string; name: string; email: string };
  reviewer: { id: string; name: string; email: string } | null;
};

function toAdminSummary(row: CorrectionRow & {
  member?: MemberRef | null;
  reviewer?: MemberRef | null;
}): CorrectionAdminSummary {
  return {
    ...toSummary(row),
    member: row.member
      ? {
          id: row.member.id,
          name: row.member.user.name,
          email: row.member.user.email,
        }
      : { id: row.memberId, name: "", email: "" },
    reviewer: row.reviewer
      ? {
          id: row.reviewer.id,
          name: row.reviewer.user.name,
          email: row.reviewer.user.email,
        }
      : null,
  };
}

const MEMBER_INCLUDE = {
  member: { include: { user: { select: { id: true, name: true, email: true } } } },
  reviewer: { include: { user: { select: { id: true, name: true, email: true } } } },
} as const;

export type SubmitCorrectionInput = {
  ctx: TenantContext;
  attendanceLogId?: string | null;
  requestType: string;
  requestedTimestamp: string | Date;
  reason: string;
  proof?: CorrectionProof | null;
  ip?: string | null;
  userAgent?: string | null;
  now?: Date;
};

/**
 * Karyawan mengajukan revisi. Validasi window/frekuensi/timestamp dilakukan di
 * server; bukti disimpan di filesystem dan DB hanya menyimpan URL + SHA-256.
 */
export async function submitCorrection(
  input: SubmitCorrectionInput,
): Promise<CorrectionSummary> {
  const now = input.now ?? new Date();
  const requestType = normalizeRequestType(input.requestType);
  const requestedTimestamp = parseRequestedTimestamp(input.requestedTimestamp);
  const reason = normalizeReason(input.reason);

  if (requestedTimestamp.getTime() > now.getTime()) {
    throw new HttpError(400, "FUTURE_TIMESTAMP", "Timestamp revisi tidak boleh di masa depan");
  }
  const windowDays = revisionWindowDays();
  const dayDistance = Math.floor(
    (startOfUtcDay(now).getTime() - startOfUtcDay(requestedTimestamp).getTime()) / 86_400_000,
  );
  if (dayDistance > windowDays) {
    throw new HttpError(
      400,
      "WINDOW_EXCEEDED",
      `Revisi hanya dapat diajukan maksimal ${windowDays} hari ke belakang`,
    );
  }

  if (input.attendanceLogId && !isUuid(input.attendanceLogId)) {
    throw new HttpError(403, "ATTENDANCE_LOG_FORBIDDEN", "Absensi tidak dapat direvisi");
  }

  const stored = input.proof ? await storeProof(input.proof) : null;
  const correctionId = randomUUID();
  let committed = false;
  try {
    const result = await withTenant(input.ctx, async (db) => {
      const limit = revisionMonthlyLimit();
      const used = await db.correctionRequest.count({
        where: {
          memberId: input.ctx.memberId,
          createdAt: { gte: startOfUtcMonth(now), lt: endOfUtcMonth(now) },
        },
      });
      if (used >= limit) {
        const retryAfterSeconds = Math.max(
          1,
          Math.ceil((endOfUtcMonth(now).getTime() - now.getTime()) / 1000),
        );
        throw new HttpError(
          429,
          "REVISION_LIMIT_EXCEEDED",
          `Batas ${limit} pengajuan revisi per bulan sudah tercapai`,
          retryAfterSeconds,
        );
      }

      let originalTimestamp: Date | null = null;
      if (!input.attendanceLogId) {
        // Revisi yang menyasar absensi yang sudah ada wajib menunjuk log tersebut,
        // agar approve tidak menimpa baris yang salah.
        const existing = await db.attendanceLog.findFirst({
          where: {
            memberId: input.ctx.memberId,
            workDate: startOfUtcDay(requestedTimestamp),
            type: requestType,
          },
          select: { id: true },
        });
        if (existing) {
          throw new HttpError(
            400,
            "ATTENDANCE_LOG_REQUIRED",
            "Sertakan attendanceLogId untuk absensi yang sudah tercatat",
          );
        }
      }
      if (input.attendanceLogId) {
        const log = await db.attendanceLog.findFirst({
          where: { id: input.attendanceLogId },
        });
        if (!log || log.memberId !== input.ctx.memberId) {
          throw new HttpError(403, "ATTENDANCE_LOG_FORBIDDEN", "Absensi tidak dapat direvisi");
        }
        if (log.type !== requestType) {
          throw new HttpError(
            400,
            "REQUEST_TYPE_MISMATCH",
            "Tipe revisi tidak sesuai dengan absensi yang dipilih",
          );
        }
        originalTimestamp = log.timestampServer;
      }

      const created = await db.correctionRequest.create({
        data: {
          id: correctionId,
          tenantId: input.ctx.tenantId,
          memberId: input.ctx.memberId,
          attendanceLogId: input.attendanceLogId ?? null,
          requestType,
          requestedTimestamp,
          originalTimestamp,
          reason,
          proofUrl: stored?.url ?? null,
          proofHash: stored?.hash ?? null,
          status: "PENDING",
        },
      });

      await writeAudit(
        {
          tenantId: input.ctx.tenantId,
          actorType: "USER",
          actorUserId: input.ctx.userId,
          actorMemberId: input.ctx.memberId,
          action: "correction.request",
          resourceType: "correction",
          resourceId: created.id,
          // Alasan dan isi bukti tidak pernah masuk metadata audit.
          metadata: {
            requestType,
            requestedTimestamp: requestedTimestamp.toISOString(),
            hasProof: stored !== null,
          },
          ip: input.ip ?? null,
          userAgent: input.userAgent ?? null,
        },
        db as never,
      );

      committed = true;
      return toSummary(created);
    });
    return result;
  } finally {
    if (stored && !committed) {
      await unlink(stored.path).catch(() => undefined);
    }
  }
}

export async function listMyCorrections(input: {
  ctx: TenantContext;
  status?: string | undefined;
  from?: string | undefined;
  to?: string | undefined;
}): Promise<CorrectionSummary[]> {
  const status = normalizeStatus(input.status);
  const range = timestampRange(input.from, input.to);
  const rows = await withTenant(input.ctx, (db) =>
    db.correctionRequest.findMany({
      where: {
        memberId: input.ctx.memberId,
        ...(status ? { status } : {}),
        ...(range ? { requestedTimestamp: range } : {}),
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 200,
    }),
  );
  return rows.map(toSummary);
}

function pageValue(value: number | undefined, fallback: number, min: number, max: number): number {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new HttpError(400, "INVALID_PAGINATION", "Parameter pagination tidak valid");
  }
  return value;
}

export type ListWorkspaceCorrectionsInput = {
  ctx: TenantContext;
  workspaceId: string;
  status?: string | undefined;
  memberId?: string | undefined;
  from?: string | undefined;
  to?: string | undefined;
  limit?: number | undefined;
  offset?: number | undefined;
};

export type ListWorkspaceCorrectionsResult = {
  corrections: CorrectionAdminSummary[];
  pagination: { limit: number; offset: number; total: number };
};

/**
 * Antrian admin. `:workspaceId` hanya klaim; filter tenant berasal dari ctx.
 * Workspace asing dan tidak ada menghasilkan 403 identik.
 */
export async function listWorkspaceCorrections(
  input: ListWorkspaceCorrectionsInput,
): Promise<ListWorkspaceCorrectionsResult> {
  assertWorkspaceReadClaim(input.ctx, input.workspaceId);
  const status = normalizeStatus(input.status);
  if (input.memberId && !isUuid(input.memberId)) {
    throw new HttpError(400, "INVALID_MEMBER", "Parameter memberId tidak valid");
  }
  const range = timestampRange(input.from, input.to);
  const limit = pageValue(
    input.limit,
    CORRECTION_LIST_DEFAULT_LIMIT,
    1,
    CORRECTION_LIST_MAX_LIMIT,
  );
  const offset = pageValue(input.offset, 0, 0, Number.MAX_SAFE_INTEGER);

  return withTenant(input.ctx, async (db) => {
    const where = {
      ...(status ? { status } : {}),
      ...(input.memberId ? { memberId: input.memberId } : {}),
      ...(range ? { requestedTimestamp: range } : {}),
    };
    const total = await db.correctionRequest.count({ where });
    const rows = await db.correctionRequest.findMany({
      where,
      include: MEMBER_INCLUDE,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit,
      skip: offset,
    });
    return {
      corrections: rows.map(toAdminSummary),
      pagination: { limit, offset, total },
    };
  });
}

export async function getWorkspaceCorrection(input: {
  ctx: TenantContext;
  workspaceId: string;
  correctionId: string;
}): Promise<CorrectionAdminSummary> {
  assertWorkspaceReadClaim(input.ctx, input.workspaceId);
  if (!isUuid(input.correctionId)) {
    throw new HttpError(404, "CORRECTION_NOT_FOUND", "Revisi tidak ditemukan");
  }
  const row = await withTenant(input.ctx, (db) =>
    db.correctionRequest.findFirst({
      where: { id: input.correctionId },
      include: MEMBER_INCLUDE,
    }),
  );
  if (!row) {
    throw new HttpError(404, "CORRECTION_NOT_FOUND", "Revisi tidak ditemukan");
  }
  return toAdminSummary(row);
}

export type ReviewCorrectionInput = {
  ctx: TenantContext;
  correctionId: string;
  action: string;
  rejectionReason?: string | undefined;
  ip?: string | null;
  userAgent?: string | null;
  now?: Date;
};

function isPrismaUniqueError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "P2002"
  );
}

async function createCorrectionAttendanceLog(
  tx: Prisma.TransactionClient,
  input: {
    ctx: TenantContext;
    correctionId: string;
    memberId: string;
    requestType: CorrectionType;
    requestedTimestamp: Date;
  },
): Promise<string> {
  const office = await tx.officeLocation.findFirst({
    where: { tenantId: input.ctx.tenantId, isActive: true },
    orderBy: { createdAt: "asc" },
  });
  const id = randomUUID();
  try {
    await tx.attendanceLog.create({
      data: {
        id,
        tenantId: input.ctx.tenantId,
        memberId: input.memberId,
        workDate: startOfUtcDay(input.requestedTimestamp),
        type: input.requestType,
        timestampServer: input.requestedTimestamp,
        latitude: office?.latitude ?? 0,
        longitude: office?.longitude ?? 0,
        accuracyMeters: 0,
        distanceMeters: 0,
        isMockLocation: false,
        isSuspicious: false,
        isCorrection: true,
        photoUrl: "",
        photoHash: "",
        deviceInfo: `correction:${input.correctionId}`.slice(0, 255),
      },
    });
  } catch (error) {
    if (isPrismaUniqueError(error)) {
      throw new HttpError(
        409,
        "ATTENDANCE_CONFLICT",
        "Absensi untuk tanggal dan tipe tersebut sudah ada",
      );
    }
    throw error;
  }
  return id;
}

/**
 * Approve/reject hanya untuk status PENDING. Approve memperbarui attendance_logs
 * dan menulis audit {from, to} dalam transaksi yang sama.
 */
export async function reviewCorrection(input: ReviewCorrectionInput): Promise<CorrectionSummary> {
  const canReview =
    input.ctx.permissions.includes("correction.review") ||
    input.ctx.roleKeys.includes("WORKSPACE_OWNER") ||
    input.ctx.roleKeys.includes("WORKSPACE_ADMIN");
  if (!canReview) {
    throw new HttpError(403, "FORBIDDEN", "Permission tidak mencukupi");
  }
  if (input.action !== "approve" && input.action !== "reject") {
    throw new HttpError(400, "INVALID_ACTION", "Action harus approve atau reject");
  }
  const rejectReason = (input.rejectionReason ?? "").trim();
  if (input.action === "reject") {
    if (rejectReason.length === 0) {
      throw new HttpError(400, "REJECTION_REASON_REQUIRED", "Alasan penolakan wajib diisi");
    }
    if (rejectReason.length < CORRECTION_REASON_MIN_LENGTH) {
      throw new HttpError(
        400,
        "REJECTION_REASON_TOO_SHORT",
        `Alasan penolakan minimal ${CORRECTION_REASON_MIN_LENGTH} karakter`,
      );
    }
    if (rejectReason.length > CORRECTION_REASON_MAX_LENGTH) {
      throw new HttpError(400, "REJECTION_REASON_TOO_LONG", "Alasan penolakan terlalu panjang");
    }
  }

  const now = input.now ?? new Date();
  return withTenant(input.ctx, async (db) =>
    db.$transaction(async (tx) => {
      const correction = await tx.correctionRequest.findFirst({
        where: { id: input.correctionId, tenantId: input.ctx.tenantId },
      });
      if (!correction) {
        // Identik dengan tenant asing: keberadaan revisi tenant lain tidak bocor.
        throw new HttpError(403, "CORRECTION_FORBIDDEN", "Revisi tidak dapat diproses");
      }
      if (correction.status !== "PENDING") {
        throw new HttpError(409, "ALREADY_REVIEWED", "Revisi sudah diproses");
      }

      const requestType = correction.requestType as CorrectionType;
      const reviewedAt = now;
      let attendanceLogId = correction.attendanceLogId;

      if (input.action === "approve") {
        if (correction.attendanceLogId) {
          const existing = await tx.attendanceLog.findFirst({
            where: { id: correction.attendanceLogId, tenantId: input.ctx.tenantId },
          });
          if (existing) {
            try {
              await tx.attendanceLog.update({
                where: {
                  tenantId_id: {
                    tenantId: input.ctx.tenantId,
                    id: existing.id,
                  },
                },
                data: {
                  timestampServer: correction.requestedTimestamp,
                  workDate: startOfUtcDay(correction.requestedTimestamp),
                },
              });
            } catch (error) {
              if (isPrismaUniqueError(error)) {
                throw new HttpError(
                  409,
                  "ATTENDANCE_CONFLICT",
                  "Absensi untuk tanggal dan tipe tersebut sudah ada",
                );
              }
              throw error;
            }
            attendanceLogId = existing.id;
          } else {
            // Log lama sudah tidak ada; buat log koreksi baru alih-alih menunjuk baris hilang.
            attendanceLogId = null;
          }
        }
        if (!attendanceLogId) {
          attendanceLogId = await createCorrectionAttendanceLog(tx, {
            ctx: input.ctx,
            correctionId: correction.id,
            memberId: correction.memberId,
            requestType,
            requestedTimestamp: correction.requestedTimestamp,
          });
        }
      }

      const updated = await tx.correctionRequest.updateMany({
        where: { id: correction.id, tenantId: input.ctx.tenantId, status: "PENDING" },
        data:
          input.action === "approve"
            ? {
                status: "APPROVED",
                reviewedByMemberId: input.ctx.memberId,
                reviewedAt,
                rejectionReason: null,
              }
            : {
                status: "REJECTED",
                reviewedByMemberId: input.ctx.memberId,
                reviewedAt,
                rejectionReason: rejectReason,
              },
      });
      if (updated.count !== 1) {
        throw new HttpError(409, "ALREADY_REVIEWED", "Revisi sudah diproses");
      }

      await createInAppNotification(tx, {
        tenantId: input.ctx.tenantId,
        memberId: correction.memberId,
        type: input.action === "approve" ? "CORRECTION_APPROVED" : "CORRECTION_REJECTED",
        title: input.action === "approve" ? "Revisi disetujui" : "Revisi ditolak",
        body:
          input.action === "approve"
            ? "Data kehadiran Anda sudah diperbarui."
            : "Buka aplikasi untuk melihat alasan penolakan.",
        linkUrl: `/workspaces/${input.ctx.tenantId}/corrections/${correction.id}`,
      });

      await writeAudit(
        {
          tenantId: input.ctx.tenantId,
          actorType: "USER",
          actorUserId: input.ctx.userId,
          actorMemberId: input.ctx.memberId,
          action: input.action === "approve" ? "correction.approve" : "correction.reject",
          resourceType: "correction",
          resourceId: correction.id,
          metadata:
            input.action === "approve"
              ? {
                  from: correction.originalTimestamp
                    ? correction.originalTimestamp.toISOString()
                    : null,
                  to: correction.requestedTimestamp.toISOString(),
                  attendanceLogId,
                }
              : {
                  // Isi alasan penolakan tidak masuk audit mentah.
                  reason_length: rejectReason.length,
                  hasReason: true,
                },
          ip: input.ip ?? null,
          userAgent: input.userAgent ?? null,
        },
        tx,
      );

      const row = await tx.correctionRequest.findFirst({
        where: { id: correction.id, tenantId: input.ctx.tenantId },
      });
      if (!row) {
        throw new HttpError(409, "CORRECTION_CHANGED", "Revisi berubah; muat ulang data");
      }
      return toSummary(row);
    }),
  );
}
