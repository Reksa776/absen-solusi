import { randomUUID } from "node:crypto";

import {
  isUuid,
  withTenant,
  writeAudit,
  type TenantContext,
} from "@absensi/database";

import { HttpError } from "./http.js";
import { createInAppNotification } from "./inbox.js";
import { CORRECTION_REASON_MAX_LENGTH, CORRECTION_REASON_MIN_LENGTH } from "./corrections.js";
import { assertWorkspaceReadClaim } from "./workspaces.js";

export const BULK_CORRECTION_MAX_MEMBERS = 100;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export type BulkCorrectionInput = {
  ctx: TenantContext;
  workspaceId: string;
  memberIds: string[];
  date: string;
  type: string;
  timestamp: string;
  reason: string;
  ip?: string | null;
  userAgent?: string | null;
  now?: Date;
};

export type BulkCorrectionResult = {
  batchId: string;
  updated: number;
  changes: Array<{
    memberId: string;
    attendanceLogId: string;
    from: string | null;
    to: string;
  }>;
};

function parseDate(value: string): Date {
  if (!DATE_PATTERN.test(value)) {
    throw new HttpError(400, "INVALID_DATE", "Tanggal harus berformat YYYY-MM-DD");
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new HttpError(400, "INVALID_DATE", "Tanggal tidak valid");
  }
  return date;
}

function normalizeMemberIds(value: string[]): string[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new HttpError(400, "MEMBERS_REQUIRED", "Pilih minimal satu karyawan");
  }
  if (value.length > BULK_CORRECTION_MAX_MEMBERS) {
    throw new HttpError(
      400,
      "TOO_MANY_MEMBERS",
      `Maksimal ${BULK_CORRECTION_MAX_MEMBERS} karyawan per koreksi massal`,
    );
  }
  const unique = [...new Set(value.map((id) => id.trim()))];
  if (unique.some((id) => !isUuid(id))) {
    throw new HttpError(400, "INVALID_MEMBER", "ID karyawan tidak valid");
  }
  if (unique.length !== value.length) {
    throw new HttpError(400, "DUPLICATE_MEMBER", "Karyawan yang dipilih tidak boleh duplikat");
  }
  return unique;
}

function normalizeReason(value: string): string {
  const reason = value.trim();
  if (reason.length < CORRECTION_REASON_MIN_LENGTH) {
    throw new HttpError(
      400,
      "ALASAN_TOO_SHORT",
      `Alasan koreksi minimal ${CORRECTION_REASON_MIN_LENGTH} karakter`,
    );
  }
  if (reason.length > CORRECTION_REASON_MAX_LENGTH) {
    throw new HttpError(400, "ALASAN_TOO_LONG", "Alasan koreksi terlalu panjang");
  }
  return reason;
}

function isPrismaUniqueError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "P2002"
  );
}

/**
 * Koreksi massal atomik. Satu member tidak valid membatalkan seluruh batch,
 * termasuk audit dan notifikasi yang sudah ditulis di transaksi yang sama.
 */
export async function bulkCorrectAttendance(
  input: BulkCorrectionInput,
): Promise<BulkCorrectionResult> {
  if (!input.ctx.permissions.includes("correction.review")) {
    throw new HttpError(403, "FORBIDDEN", "Permission tidak mencukupi");
  }
  assertWorkspaceReadClaim(input.ctx, input.workspaceId);
  const memberIds = normalizeMemberIds(input.memberIds);
  const workDate = parseDate(input.date);
  if (input.type !== "CHECK_IN" && input.type !== "CHECK_OUT") {
    throw new HttpError(400, "INVALID_REQUEST_TYPE", "Tipe harus CHECK_IN atau CHECK_OUT");
  }
  const timestamp = new Date(input.timestamp);
  if (Number.isNaN(timestamp.getTime())) {
    throw new HttpError(400, "INVALID_TIMESTAMP", "Waktu koreksi tidak valid");
  }
  const reason = normalizeReason(input.reason);
  const batchId = randomUUID();
  const now = input.now ?? new Date();
  const reasonLength = reason.length;

  try {
    return await withTenant(input.ctx, async (db) =>
      db.$transaction(async (tx) => {
        const members = await tx.workspaceMember.findMany({
          where: { id: { in: memberIds }, status: "ACTIVE" },
          select: { id: true },
        });
        if (members.length !== memberIds.length) {
          throw new HttpError(
            400,
            "MEMBER_NOT_FOUND",
            "Salah satu karyawan tidak ditemukan atau tidak aktif",
          );
        }
        const office = await tx.officeLocation.findFirst({
          where: { isActive: true },
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
          select: { id: true, latitude: true, longitude: true },
        });

        const changes: BulkCorrectionResult["changes"] = [];
        for (const memberId of memberIds) {
          const existing = await tx.attendanceLog.findFirst({
            where: { memberId, workDate, type: input.type },
          });
          const to = timestamp.toISOString();
          let attendanceLogId: string;
          if (existing) {
            await tx.attendanceLog.update({
              where: {
                tenantId_id: { tenantId: input.ctx.tenantId, id: existing.id },
              },
              data: { timestampServer: timestamp, isCorrection: true },
            });
            attendanceLogId = existing.id;
          } else {
            attendanceLogId = randomUUID();
            await tx.attendanceLog.create({
              data: {
                id: attendanceLogId,
                tenantId: input.ctx.tenantId,
                memberId,
                workDate,
                type: input.type,
                timestampServer: timestamp,
                latitude: office?.latitude ?? 0,
                longitude: office?.longitude ?? 0,
                accuracyMeters: 0,
                distanceMeters: 0,
                officeLocationId: office?.id ?? null,
                isMockLocation: false,
                isSuspicious: false,
                isCorrection: true,
                photoUrl: "",
                photoHash: "",
                deviceInfo: `bulk-correction:${batchId}`.slice(0, 255),
              },
            });
          }

          const from = existing ? existing.timestampServer.toISOString() : null;
          changes.push({ memberId, attendanceLogId, from, to });
          await writeAudit(
            {
              tenantId: input.ctx.tenantId,
              actorType: "USER",
              actorUserId: input.ctx.userId,
              actorMemberId: input.ctx.memberId,
              action: "correction.bulk",
              resourceType: "attendance",
              resourceId: attendanceLogId,
              metadata: {
                batch_id: batchId,
                member_id: memberId,
                date: input.date,
                type: input.type,
                from,
                to,
                reason_length: reasonLength,
              },
              ip: input.ip ?? null,
              userAgent: input.userAgent ?? null,
            },
            tx,
          );
          await createInAppNotification(tx, {
            tenantId: input.ctx.tenantId,
            memberId,
            type: "ATTENDANCE_BULK_CORRECTED",
            title: "Koreksi kehadiran massal",
            body: `Kehadiran ${input.type === "CHECK_IN" ? "check-in" : "check-out"} tanggal ${input.date} diperbarui oleh HR/Admin.`,
            linkUrl: `/workspaces/${input.ctx.tenantId}/corrections`,
            id: randomUUID(),
          });
        }
        return { batchId, updated: changes.length, changes };
      }),
    );
  } catch (error) {
    if (isPrismaUniqueError(error)) {
      throw new HttpError(
        409,
        "ATTENDANCE_CONFLICT",
        "Salah satu absensi pada tanggal tersebut sudah ada",
      );
    }
    throw error;
  }
}
