import { isUuid, withTenant, writeAudit, type TenantContext } from "@absensi/database";

import { HttpError } from "./http.js";
import { createInAppNotification } from "./inbox.js";
import { reviewOutOfTownAttendance } from "./attendance-review.js";
import { assertWorkspaceReadClaim } from "./workspaces.js";

const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const RECORD_TYPES = ["CHECK_IN", "CHECK_OUT"] as const;
const APPROVAL_STATUSES = ["PENDING", "APPROVED", "REJECTED"] as const;

export type AttendanceRecordSummary = {
  id: string;
  memberId: string;
  memberName: string;
  memberEmail: string;
  divisionName: string | null;
  type: string;
  workDate: string;
  timestampServer: string;
  latitude: number;
  longitude: number;
  accuracyMeters: number;
  distanceMeters: number;
  officeName: string | null;
  workMode: string;
  outOfRadius: boolean;
  outOfTownReason: string | null;
  approvalStatus: string;
  isSuspicious: boolean;
  isCorrection: boolean;
  photoUrl: string;
  notes: string | null;
  faceVerified: boolean;
  deviceInfo: string | null;
  userAgent: string | null;
  rejectionReason: string | null;
};

const RECORD_INCLUDE = {
  member: {
    include: {
      user: { select: { name: true, email: true } },
      division: { select: { name: true } },
    },
  },
  office: { select: { name: true } },
} as const;

function assertRead(ctx: TenantContext): void {
  if (!ctx.permissions.includes("attendance.read") && !ctx.permissions.includes("member.manage")) {
    throw new HttpError(403, "FORBIDDEN", "Permission tidak mencukupi");
  }
}

function assertReview(ctx: TenantContext): void {
  if (!ctx.permissions.includes("correction.review")) {
    throw new HttpError(403, "FORBIDDEN", "Permission tidak mencukupi");
  }
}

function day(value: unknown, field: string): Date | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string" || !DAY_PATTERN.test(value)) {
    throw new HttpError(400, "INVALID_DATE", `${field} harus berformat YYYY-MM-DD`);
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) {
    throw new HttpError(400, "INVALID_DATE", `${field} tidak valid`);
  }
  return parsed;
}

function filterValue<T extends readonly string[]>(
  value: string | undefined,
  allowed: T,
  field: string,
): string | undefined {
  if (!value) return undefined;
  const normalized = value.trim().toUpperCase();
  if (!allowed.includes(normalized)) {
    throw new HttpError(400, "INVALID_FILTER", `${field} tidak valid`);
  }
  return normalized;
}

function toRecord(row: {
  id: string;
  memberId: string;
  type: string;
  workDate: Date;
  timestampServer: Date;
  latitude: number;
  longitude: number;
  accuracyMeters: number;
  distanceMeters: number;
  workMode: string;
  outOfRadius: boolean;
  outOfTownReason: string | null;
  approvalStatus: string;
  isSuspicious: boolean;
  isCorrection: boolean;
  photoUrl: string;
  notes: string | null;
  faceVerified: boolean;
  deviceInfo: string | null;
  userAgent: string | null;
  rejectionReason: string | null;
  member: {
    user: { name: string; email: string };
    division: { name: string } | null;
  };
  office: { name: string } | null;
}): AttendanceRecordSummary {
  return {
    id: row.id,
    memberId: row.memberId,
    memberName: row.member.user.name,
    memberEmail: row.member.user.email,
    divisionName: row.member.division?.name ?? null,
    type: row.type,
    workDate: row.workDate.toISOString().slice(0, 10),
    timestampServer: row.timestampServer.toISOString(),
    latitude: row.latitude,
    longitude: row.longitude,
    accuracyMeters: row.accuracyMeters,
    distanceMeters: row.distanceMeters,
    officeName: row.office?.name ?? null,
    workMode: row.workMode,
    outOfRadius: row.outOfRadius,
    outOfTownReason: row.outOfTownReason,
    approvalStatus: row.approvalStatus,
    isSuspicious: row.isSuspicious,
    isCorrection: row.isCorrection,
    photoUrl: row.photoUrl,
    notes: row.notes,
    faceVerified: row.faceVerified,
    deviceInfo: row.deviceInfo,
    userAgent: row.userAgent,
    rejectionReason: row.rejectionReason,
  };
}

export async function listAttendanceRecords(input: {
  ctx: TenantContext;
  workspaceId: string;
  date?: string | undefined;
  from?: string | undefined;
  to?: string | undefined;
  type?: string | undefined;
  approvalStatus?: string | undefined;
  memberId?: string | undefined;
  limit?: number | undefined;
}): Promise<AttendanceRecordSummary[]> {
  assertRead(input.ctx);
  assertWorkspaceReadClaim(input.ctx, input.workspaceId);
  const date = day(input.date, "Tanggal");
  const from = day(input.from, "Dari tanggal");
  const to = day(input.to, "Sampai tanggal");
  const type = filterValue(input.type, RECORD_TYPES, "Tipe presensi");
  const approvalStatus = filterValue(input.approvalStatus, APPROVAL_STATUSES, "Status approval");
  if (input.memberId && !isUuid(input.memberId)) {
    throw new HttpError(400, "INVALID_MEMBER", "Karyawan tidak valid");
  }
  const limit = Math.min(Math.max(Number(input.limit ?? 200), 1), 500);
  const rows = await withTenant(input.ctx, (db) =>
    db.attendanceLog.findMany({
      where: {
        ...(date ? { workDate: date } : {}),
        ...(from || to
          ? {
              workDate: {
                ...(from ? { gte: from } : {}),
                ...(to ? { lte: to } : {}),
              },
            }
          : {}),
        ...(type ? { type } : {}),
        ...(approvalStatus ? { approvalStatus } : {}),
        ...(input.memberId ? { memberId: input.memberId } : {}),
      },
      include: RECORD_INCLUDE,
      orderBy: [{ timestampServer: "desc" }, { id: "desc" }],
      take: limit,
    }),
  );
  return rows.map(toRecord);
}

export function attendanceRecordsToCsv(rows: AttendanceRecordSummary[]): string {
  const header = [
    "work_date",
    "timestamp_server",
    "member_name",
    "member_email",
    "division",
    "type",
    "work_mode",
    "latitude",
    "longitude",
    "accuracy_meters",
    "distance_meters",
    "office",
    "out_of_radius",
    "approval_status",
    "face_verified",
    "device",
    "notes",
    "photo_url",
  ].join(",");
  const escape = (value: unknown) => {
    const text = value === null || value === undefined ? "" : String(value);
    return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
  };
  const lines = rows.map((row) =>
    [
      row.workDate,
      row.timestampServer,
      row.memberName,
      row.memberEmail,
      row.divisionName,
      row.type,
      row.workMode,
      row.latitude.toFixed(6),
      row.longitude.toFixed(6),
      row.accuracyMeters,
      row.distanceMeters,
      row.officeName,
      row.outOfRadius,
      row.approvalStatus,
      row.faceVerified,
      row.deviceInfo,
      row.notes,
      row.photoUrl,
    ]
      .map(escape)
      .join(","),
  );
  return [header, ...lines].join("\n");
}

export async function listAttendanceApprovals(input: {
  ctx: TenantContext;
  workspaceId: string;
}): Promise<AttendanceRecordSummary[]> {
  assertReview(input.ctx);
  assertWorkspaceReadClaim(input.ctx, input.workspaceId);
  const rows = await withTenant(input.ctx, (db) =>
    db.attendanceLog.findMany({
      where: { approvalStatus: "PENDING" },
      include: RECORD_INCLUDE,
      orderBy: [{ timestampServer: "asc" }, { id: "asc" }],
      take: 200,
    }),
  );
  return rows.map(toRecord);
}

export async function reviewAttendanceRecord(input: {
  ctx: TenantContext;
  workspaceId: string;
  attendanceId: string;
  action: string;
  rejectionReason?: string | undefined;
  ip?: string | null;
  userAgent?: string | null;
  now?: Date;
}): Promise<AttendanceRecordSummary> {
  assertReview(input.ctx);
  assertWorkspaceReadClaim(input.ctx, input.workspaceId);
  if (!isUuid(input.attendanceId)) {
    throw new HttpError(404, "ATTENDANCE_NOT_FOUND", "Presensi tidak ditemukan");
  }
  const action = input.action.trim().toUpperCase();
  if (action !== "APPROVE" && action !== "REJECT") {
    throw new HttpError(400, "INVALID_ACTION", "Action harus APPROVE atau REJECT");
  }
  const reason = (input.rejectionReason ?? "").trim();
  if (action === "REJECT" && (reason.length < 5 || reason.length > 500)) {
    throw new HttpError(400, "INVALID_REJECTION_REASON", "Alasan penolakan 5-500 karakter");
  }
  const existing = await withTenant(input.ctx, (db) =>
    db.attendanceLog.findFirst({ where: { id: input.attendanceId } }),
  );
  if (!existing) {
    throw new HttpError(404, "ATTENDANCE_NOT_FOUND", "Presensi tidak ditemukan");
  }
  if (existing.approvalStatus !== "PENDING") {
    throw new HttpError(409, "ALREADY_REVIEWED", "Presensi sudah direview");
  }
  if (existing.workMode === "OUT_OF_TOWN") {
    const reviewed = await reviewOutOfTownAttendance({
      ctx: input.ctx,
      workspaceId: input.workspaceId,
      attendanceId: input.attendanceId,
      action,
      rejectionReason: reason,
      ip: input.ip ?? null,
      userAgent: input.userAgent ?? null,
      now: input.now ?? new Date(),
    });
    const row = await withTenant(input.ctx, (db) =>
      db.attendanceLog.findFirstOrThrow({
        where: { id: reviewed.id },
        include: RECORD_INCLUDE,
      }),
    );
    return toRecord(row);
  }

  const now = input.now ?? new Date();
  const row = await withTenant(input.ctx, (db) =>
    db.$transaction(async (tx) => {
      const saved = await tx.attendanceLog.update({
        where: { tenantId_id: { tenantId: input.ctx.tenantId, id: existing.id } },
        data: {
          approvalStatus: action === "APPROVE" ? "APPROVED" : "REJECTED",
          reviewedByMemberId: input.ctx.memberId,
          reviewedAt: now,
          rejectionReason: action === "REJECT" ? reason : null,
        },
        include: RECORD_INCLUDE,
      });
      await createInAppNotification(tx, {
        tenantId: input.ctx.tenantId,
        memberId: existing.memberId,
        type: action === "APPROVE" ? "ATTENDANCE_APPROVED" : "ATTENDANCE_REJECTED",
        title: action === "APPROVE" ? "Presensi disetujui" : "Presensi ditolak",
        body:
          action === "APPROVE"
            ? "Presensi Anda sudah diverifikasi atasan."
            : "Presensi Anda ditolak. Buka rekap presensi untuk melihat alasannya.",
        linkUrl: `/workspaces/${input.ctx.tenantId}/attendance/notes`,
      });
      await writeAudit(
        {
          tenantId: input.ctx.tenantId,
          actorType: "USER",
          actorUserId: input.ctx.userId,
          actorMemberId: input.ctx.memberId,
          action: action === "APPROVE" ? "attendance.approve" : "attendance.reject",
          resourceType: "attendance",
          resourceId: existing.id,
          metadata: {
            memberId: existing.memberId,
            workMode: existing.workMode,
            outOfRadius: existing.outOfRadius,
            ...(action === "REJECT" ? { reasonLength: reason.length } : {}),
          },
          ip: input.ip ?? null,
          userAgent: input.userAgent ?? null,
        },
        tx,
      );
      return saved;
    }),
  );
  return toRecord(row);
}
