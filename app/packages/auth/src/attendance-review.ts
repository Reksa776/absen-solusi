import { withTenant, writeAudit, type TenantContext } from "@absensi/database";

import { assertApprovalActor, resolveApprovalStep } from "./approvals.js";
import { HttpError } from "./http.js";
import { createInAppNotification } from "./inbox.js";
import { assertWorkspaceReadClaim } from "./workspaces.js";

export type OutOfTownAttendanceSummary = {
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
  distanceMeters: number;
  officeName: string | null;
  reason: string | null;
  approvalStatus: string;
  currentApprovalLevel: number;
  reviewedAt: string | null;
  rejectionReason: string | null;
  photoUrl: string;
};

function assertReview(ctx: TenantContext): void {
  if (!ctx.permissions.includes("correction.review")) {
    throw new HttpError(403, "FORBIDDEN", "Permission tidak mencukupi");
  }
}

function toSummary(row: {
  id: string;
  memberId: string;
  type: string;
  workDate: Date;
  timestampServer: Date;
  latitude: number;
  longitude: number;
  distanceMeters: number;
  outOfTownReason: string | null;
  approvalStatus: string;
  currentApprovalLevel: number;
  reviewedAt: Date | null;
  rejectionReason: string | null;
  photoUrl: string;
  office: { name: string } | null;
  member: {
    user: { name: string; email: string };
    division: { name: string } | null;
  };
}): OutOfTownAttendanceSummary {
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
    distanceMeters: row.distanceMeters,
    officeName: row.office?.name ?? null,
    reason: row.outOfTownReason,
    approvalStatus: row.approvalStatus,
    currentApprovalLevel: row.currentApprovalLevel,
    reviewedAt: row.reviewedAt ? row.reviewedAt.toISOString() : null,
    rejectionReason: row.rejectionReason,
    photoUrl: row.photoUrl,
  };
}

const REVIEW_INCLUDE = {
  office: { select: { name: true } },
  member: {
    include: {
      user: { select: { name: true, email: true } },
      division: { select: { name: true } },
    },
  },
} as const;

export async function listOutOfTownAttendance(input: {
  ctx: TenantContext;
  workspaceId: string;
  status?: string | undefined;
}): Promise<OutOfTownAttendanceSummary[]> {
  assertReview(input.ctx);
  assertWorkspaceReadClaim(input.ctx, input.workspaceId);
  const status = input.status?.trim().toUpperCase() || "PENDING";
  if (!["PENDING", "APPROVED", "REJECTED", "ALL"].includes(status)) {
    throw new HttpError(400, "INVALID_STATUS", "Status review tidak valid");
  }
  const rows = await withTenant(input.ctx, (db) =>
    db.attendanceLog.findMany({
      where: {
        workMode: "OUT_OF_TOWN",
        ...(status === "ALL" ? {} : { approvalStatus: status }),
      },
      include: REVIEW_INCLUDE,
      orderBy: [{ timestampServer: "desc" }, { id: "desc" }],
      take: 200,
    }),
  );
  return rows.map(toSummary);
}

export async function reviewOutOfTownAttendance(input: {
  ctx: TenantContext;
  workspaceId: string;
  attendanceId: string;
  action: string;
  rejectionReason?: string | undefined;
  ip?: string | null;
  userAgent?: string | null;
  now?: Date;
}): Promise<OutOfTownAttendanceSummary> {
  assertReview(input.ctx);
  assertWorkspaceReadClaim(input.ctx, input.workspaceId);
  const action = input.action.trim().toUpperCase();
  if (action !== "APPROVE" && action !== "REJECT") {
    throw new HttpError(400, "INVALID_ACTION", "Action harus APPROVE atau REJECT");
  }
  const reason = (input.rejectionReason ?? "").trim();
  if (action === "REJECT" && (reason.length < 5 || reason.length > 500)) {
    throw new HttpError(400, "INVALID_REJECTION_REASON", "Alasan penolakan 5–500 karakter");
  }
  const now = input.now ?? new Date();

  return withTenant(input.ctx, (db) =>
    db.$transaction(async (tx) => {
      const log = await tx.attendanceLog.findFirst({
        where: { id: input.attendanceId, workMode: "OUT_OF_TOWN" },
        include: REVIEW_INCLUDE,
      });
      if (!log) {
        throw new HttpError(404, "ATTENDANCE_NOT_FOUND", "Presensi tidak ditemukan");
      }
      if (log.approvalStatus !== "PENDING") {
        throw new HttpError(409, "ALREADY_REVIEWED", "Presensi sudah direview");
      }

      let nextLevel = log.currentApprovalLevel;
      let approvalStatus = "APPROVED";
      if (action === "APPROVE") {
        const resolved = await resolveApprovalStep(
          tx,
          input.ctx.tenantId,
          "OUT_OF_TOWN",
          log.currentApprovalLevel,
        );
        if (resolved?.step) {
          assertApprovalActor({ ctx: input.ctx, step: resolved.step });
          if (resolved.step.level < resolved.totalSteps) {
            nextLevel = resolved.step.level;
            approvalStatus = "PENDING";
          }
        }
      } else {
        approvalStatus = "REJECTED";
      }

      const updated = await tx.attendanceLog.update({
        where: { tenantId_id: { tenantId: input.ctx.tenantId, id: log.id } },
        data: {
          approvalStatus,
          currentApprovalLevel: nextLevel,
          reviewedByMemberId: input.ctx.memberId,
          reviewedAt: approvalStatus === "PENDING" ? log.reviewedAt : now,
          rejectionReason: action === "REJECT" ? reason : null,
        },
        include: REVIEW_INCLUDE,
      });

      await createInAppNotification(tx, {
        tenantId: input.ctx.tenantId,
        memberId: log.memberId,
        type:
          approvalStatus === "PENDING"
            ? "OUT_OF_TOWN_NEXT_APPROVAL"
            : action === "REJECT"
              ? "OUT_OF_TOWN_REJECTED"
              : "OUT_OF_TOWN_APPROVED",
        title:
          approvalStatus === "PENDING"
            ? "Presensi luar kota menunggu level berikutnya"
            : action === "REJECT"
              ? "Presensi luar kota ditolak"
              : "Presensi luar kota disetujui",
        body:
          approvalStatus === "PENDING"
            ? "Presensi Anda sudah disetujui pada level ini dan diteruskan ke approver berikutnya."
            : action === "REJECT"
              ? "Buka riwayat untuk melihat alasan penolakan."
              : "Presensi luar kota Anda sudah disetujui penuh.",
        linkUrl: `/workspaces/${input.ctx.tenantId}/attendance-review`,
      });

      await writeAudit(
        {
          tenantId: input.ctx.tenantId,
          actorType: "USER",
          actorUserId: input.ctx.userId,
          actorMemberId: input.ctx.memberId,
          action:
            action === "REJECT"
              ? "attendance.out_of_town_reject"
              : approvalStatus === "PENDING"
                ? "attendance.out_of_town_step"
                : "attendance.out_of_town_approve",
          resourceType: "attendance",
          resourceId: log.id,
          metadata: {
            memberId: log.memberId,
            approvalStatus,
            level: nextLevel,
            ...(action === "REJECT" ? { reasonLength: reason.length } : {}),
          },
          ip: input.ip ?? null,
          userAgent: input.userAgent ?? null,
        },
        tx,
      );
      return toSummary(updated);
    }),
  );
}
