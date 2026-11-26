import { randomUUID } from "node:crypto";

import {
  isUuid,
  withTenant,
  writeAudit,
  type Prisma,
  type TenantContext,
} from "@absensi/database";

import { HttpError } from "./http.js";
import { createInAppNotification } from "./inbox.js";
import { sendPushNotificationToMember } from "./push-notifications.js";
import { parseReportDay, startOfUtcDay } from "./reports.js";
import {
  storeWorkPlanAttachment,
  type WorkPlanAttachmentInput,
} from "./work-plan-attachment.js";
import {
  parseRemoteWorkMode,
  parseWorkPlanItemTitles,
  upsertWorkPlanRecord,
  workPlanDay,
  type RemoteWorkMode,
  type WorkPlanSummary,
} from "./work-plans.js";
import { assertWorkspaceReadClaim } from "./workspaces.js";
import { parseStatus } from "./overtime.js";

export const WFH_REASON_MIN_LENGTH = 10;
export const WFH_REASON_MAX_LENGTH = 1000;

export type WfhSummary = {
  id: string;
  memberId: string;
  memberName: string;
  memberDivision: string | null;
  memberPosition: string | null;
  date: string;
  workMode: RemoteWorkMode;
  locationNote: string | null;
  reason: string;
  status: string;
  reviewedAt: string | null;
  rejectionReason: string | null;
  planAttachmentUrl: string | null;
  workPlan: WorkPlanSummary | null;
  createdAt: string;
};

const WFH_INCLUDE = {
  member: {
    include: {
      user: { select: { name: true } },
      division: { select: { name: true } },
      position: { select: { name: true } },
    },
  },
  workPlan: {
    include: {
      items: { orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] },
      member: { include: { user: { select: { name: true } } } },
    },
  },
} satisfies Prisma.WfhRequestInclude;

function assertReview(ctx: TenantContext): void {
  if (!ctx.permissions.includes("correction.review")) {
    throw new HttpError(403, "FORBIDDEN", "Permission tidak mencukupi");
  }
}

type WfhRow = Prisma.WfhRequestGetPayload<{ include: typeof WFH_INCLUDE }>;

function toSummary(row: WfhRow): WfhSummary {
  const items = row.workPlan?.items ?? [];
  return {
    id: row.id,
    memberId: row.memberId,
    memberName: row.member.user.name,
    memberDivision: row.member.division?.name ?? null,
    memberPosition: row.member.position?.name ?? null,
    date: row.date.toISOString().slice(0, 10),
    workMode: row.workMode === "WFC" ? "WFC" : "WFH",
    locationNote: row.locationNote,
    reason: row.reason,
    status: row.status,
    reviewedAt: row.reviewedAt ? row.reviewedAt.toISOString() : null,
    rejectionReason: row.rejectionReason,
    planAttachmentUrl: row.planAttachmentUrl,
    workPlan: row.workPlan
      ? {
          id: row.workPlan.id,
          memberId: row.workPlan.memberId,
          memberName: row.workPlan.member?.user.name ?? row.member.user.name,
          attendanceId: row.workPlan.attendanceId,
          requestId: row.workPlan.requestId,
          workMode: row.workPlan.workMode === "WFC" ? "WFC" : "WFH",
          date: workPlanDay(row.workPlan.date),
          locationNote: row.workPlan.locationNote,
          planAttachmentUrl: row.workPlan.planAttachmentUrl,
          summaryNote: row.workPlan.summaryNote,
          items: items.map((item) => ({
            id: item.id,
            title: item.title,
            isCompleted: item.isCompleted,
            completedAt: item.completedAt ? item.completedAt.toISOString() : null,
            proofUrl: item.proofUrl,
            sortOrder: item.sortOrder,
          })),
          completedCount: items.filter((item) => item.isCompleted).length,
          totalCount: items.length,
          createdAt: row.workPlan.createdAt.toISOString(),
          updatedAt: row.workPlan.updatedAt.toISOString(),
        }
      : null,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function submitWfh(input: {
  ctx: TenantContext;
  body: Record<string, unknown>;
  attachment?: WorkPlanAttachmentInput | undefined;
  ip?: string | null;
  userAgent?: string | null;
  now?: Date;
}): Promise<WfhSummary> {
  const date = parseReportDay(
    typeof input.body.date === "string" ? input.body.date : "",
    "date",
  );
  if (date.getTime() < startOfUtcDay(input.now ?? new Date()).getTime()) {
    throw new HttpError(400, "INVALID_DATE", "Tanggal WFH tidak boleh di masa lalu");
  }
  const reason =
    typeof input.body.reason === "string" ? input.body.reason.trim() : "";
  if (reason.length < WFH_REASON_MIN_LENGTH || reason.length > WFH_REASON_MAX_LENGTH) {
    throw new HttpError(
      400,
      "INVALID_REASON",
      `Alasan WFH ${WFH_REASON_MIN_LENGTH}-${WFH_REASON_MAX_LENGTH} karakter`,
    );
  }
  const explicitMode = input.body.workMode ?? input.body.work_mode;
  const workMode = parseRemoteWorkMode(explicitMode);
  const locationNote =
    typeof input.body.locationNote === "string"
      ? input.body.locationNote.trim()
      : typeof input.body.location_note === "string"
        ? input.body.location_note.trim()
        : "";
  if (workMode === "WFC" && locationNote.length < 3) {
    throw new HttpError(
      400,
      "LOCATION_REQUIRED",
      "Nama cafe/coworking/lokasi kerja wajib diisi untuk WFC",
    );
  }
  // Mode kerja eksplisit wajib disertai rencana kerja; pengajuan lama tanpa
  // workMode tetap diterima agar klien versi sebelumnya tidak rusak.
  const items = parseWorkPlanItemTitles(
    input.body.workPlanItems ?? input.body.work_plan_items ?? input.body.items,
    { required: explicitMode !== undefined },
  );
  const requestId = randomUUID();
  const stored = input.attachment
    ? await storeWorkPlanAttachment(requestId, input.attachment)
    : null;

  const created = await withTenant(input.ctx, (db) =>
    db.$transaction(async (tx) => {
      const duplicate = await tx.wfhRequest.findFirst({
        where: {
          memberId: input.ctx.memberId,
          date,
          status: { in: ["PENDING", "APPROVED"] },
        },
        select: { id: true },
      });
      if (duplicate) {
        throw new HttpError(409, "WFH_EXISTS", "Sudah ada pengajuan WFH pada tanggal tersebut");
      }
      await tx.wfhRequest.create({
        data: {
          id: requestId,
          tenantId: input.ctx.tenantId,
          memberId: input.ctx.memberId,
          date,
          workMode,
          locationNote: locationNote || (workMode === "WFH" ? "Rumah" : null),
          planAttachmentUrl: stored?.url ?? null,
          planAttachmentHash: stored?.hash ?? null,
          planAttachmentFileName: stored ? `${requestId}` : null,
          planAttachmentContentType: input.attachment?.contentType ?? null,
          reason,
        },
      });
      if (items.length > 0) {
        await upsertWorkPlanRecord(tx, {
          tenantId: input.ctx.tenantId,
          memberId: input.ctx.memberId,
          date,
          workMode,
          locationNote: locationNote || (workMode === "WFH" ? "Rumah" : null),
          planAttachmentUrl: stored?.url ?? null,
          requestId,
          items,
        });
      }
      const row = await tx.wfhRequest.findFirstOrThrow({
        where: { id: requestId },
        include: WFH_INCLUDE,
      });
      await writeAudit(
        {
          tenantId: input.ctx.tenantId,
          actorType: "USER",
          actorUserId: input.ctx.userId,
          actorMemberId: input.ctx.memberId,
          action: "wfh.request",
          resourceType: "wfh_request",
          resourceId: row.id,
          metadata: {
            date: date.toISOString().slice(0, 10),
            workMode,
            locationNote: locationNote || null,
            itemCount: items.length,
            hasAttachment: Boolean(stored),
          },
          ip: input.ip ?? null,
          userAgent: input.userAgent ?? null,
        },
        tx,
      );
      return row;
    }),
  );
  return toSummary(created);
}

export async function listMyWfh(input: {
  ctx: TenantContext;
  status?: string | undefined;
}): Promise<WfhSummary[]> {
  const status = parseStatus(input.status);
  const rows = await withTenant(input.ctx, (db) =>
    db.wfhRequest.findMany({
      where: { memberId: input.ctx.memberId, ...(status ? { status } : {}) },
      include: WFH_INCLUDE,
      orderBy: [{ date: "desc" }, { createdAt: "desc" }],
    }),
  );
  return rows.map(toSummary);
}

export async function listWorkspaceWfh(input: {
  ctx: TenantContext;
  workspaceId: string;
  status?: string | undefined;
  memberId?: string | undefined;
}): Promise<WfhSummary[]> {
  assertReview(input.ctx);
  assertWorkspaceReadClaim(input.ctx, input.workspaceId);
  if (input.memberId && !isUuid(input.memberId)) {
    throw new HttpError(400, "INVALID_MEMBER", "Member tidak valid");
  }
  const status = parseStatus(input.status);
  const rows = await withTenant(input.ctx, (db) =>
    db.wfhRequest.findMany({
      where: {
        ...(status ? { status } : {}),
        ...(input.memberId ? { memberId: input.memberId } : {}),
      },
      include: WFH_INCLUDE,
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: 100,
    }),
  );
  return rows.map(toSummary);
}

export async function reviewWfh(input: {
  ctx: TenantContext;
  wfhId: string;
  action: string;
  rejectionReason?: string | undefined;
  ip?: string | null;
  userAgent?: string | null;
  now?: Date;
}): Promise<WfhSummary> {
  assertReview(input.ctx);
  if (!isUuid(input.wfhId)) {
    throw new HttpError(400, "INVALID_REQUEST", "Pengajuan WFH tidak valid");
  }
  const action = input.action.trim().toUpperCase();
  if (action !== "APPROVE" && action !== "REJECT") {
    throw new HttpError(400, "INVALID_ACTION", "Action harus APPROVE atau REJECT");
  }
  const rejectionReason =
    typeof input.rejectionReason === "string" ? input.rejectionReason.trim() : "";
  if (action === "REJECT" && rejectionReason.length < 5) {
    throw new HttpError(400, "INVALID_REJECTION_REASON", "Alasan penolakan wajib diisi");
  }

  const updated = await withTenant(input.ctx, (db) =>
    db.$transaction(async (tx) => {
      const existing = await tx.wfhRequest.findFirst({
        where: { id: input.wfhId },
        include: WFH_INCLUDE,
      });
      if (!existing) {
        throw new HttpError(404, "WFH_NOT_FOUND", "Pengajuan WFH tidak ditemukan");
      }
      if (existing.status !== "PENDING") {
        throw new HttpError(409, "ALREADY_REVIEWED", "Pengajuan sudah direview");
      }
      const row = await tx.wfhRequest.update({
        where: { tenantId_id: { tenantId: input.ctx.tenantId, id: existing.id } },
        data: {
          status: action === "APPROVE" ? "APPROVED" : "REJECTED",
          reviewedByMemberId: input.ctx.memberId,
          reviewedAt: input.now ?? new Date(),
          rejectionReason: action === "REJECT" ? rejectionReason : null,
        },
        include: WFH_INCLUDE,
      });
      const dateLabel = existing.date.toISOString().slice(0, 10);
      const modeLabel = existing.workMode === "WFC" ? "WFC" : "WFH";
      await createInAppNotification(tx, {
        tenantId: input.ctx.tenantId,
        memberId: existing.memberId,
        type: action === "APPROVE" ? "WFH_APPROVED" : "WFH_REJECTED",
        title:
          action === "APPROVE"
            ? `${modeLabel} ${dateLabel} disetujui`
            : `${modeLabel} ${dateLabel} ditolak`,
        body:
          action === "APPROVE"
            ? `Pengajuan ${modeLabel} tanggal ${dateLabel} disetujui. Absensi pada tanggal tersebut tidak terkena geofence.`
            : `Pengajuan ${modeLabel} tanggal ${dateLabel} ditolak. Catatan admin: ${rejectionReason}`,
        linkUrl: `/workspaces/${input.ctx.tenantId}/wfh`,
      });

      await writeAudit(
        {
          tenantId: input.ctx.tenantId,
          actorType: "USER",
          actorUserId: input.ctx.userId,
          actorMemberId: input.ctx.memberId,
          action: action === "APPROVE" ? "wfh.approve" : "wfh.reject",
          resourceType: "wfh_request",
          resourceId: existing.id,
          metadata: {
            memberId: existing.memberId,
            status: row.status,
            ...(action === "REJECT" ? { rejectionReason } : {}),
          },
          ip: input.ip ?? null,
          userAgent: input.userAgent ?? null,
        },
        tx,
      );
      return row;
    }),
  );

  const summary = toSummary(updated);
  const approved = action === "APPROVE";
  const modeLabel = summary.workMode === "WFC" ? "WFC" : "WFH";
  await sendPushNotificationToMember({
    ctx: input.ctx,
    memberId: summary.memberId,
    message: {
      title: approved
        ? `${modeLabel} ${summary.date} disetujui`
        : `${modeLabel} ${summary.date} ditolak`,
      body: approved
        ? `Pengajuan ${modeLabel} Anda disetujui. Absensi pada tanggal tersebut tidak terkena geofence.`
        : `Pengajuan ${modeLabel} Anda ditolak. Buka aplikasi untuk melihat catatan admin.`,
      data: {
        type: "wfh_result",
        wfhId: summary.id,
        status: summary.status,
        workMode: summary.workMode,
      },
    },
  });
  return summary;
}
