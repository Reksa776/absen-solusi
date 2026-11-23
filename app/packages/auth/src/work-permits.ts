import { randomUUID } from "node:crypto";

import { isUuid, withTenant, writeAudit, type TenantContext } from "@absensi/database";

import { assertApprovalActor, resolveApprovalStep } from "./approvals.js";
import { HttpError } from "./http.js";
import { createInAppNotification } from "./inbox.js";
import { storePermitProof, type PermitProofInput } from "./permit-proof.js";
import { parseReportDay } from "./reports.js";
import { assertWorkspaceReadClaim } from "./workspaces.js";

export const WORK_PERMIT_TYPES = [
  "SAKIT",
  "IZIN_PRIBADI",
  "PULANG_CEPAT",
  "DATANG_TERLAMBAT",
  "LAINNYA",
] as const;
export const WORK_PERMIT_STATUSES = ["PENDING", "APPROVED", "REJECTED"] as const;
export const PERMIT_REASON_MIN_LENGTH = 10;
export const PERMIT_REASON_MAX_LENGTH = 1000;

export type WorkPermitType = (typeof WORK_PERMIT_TYPES)[number];
export type WorkPermitStatus = (typeof WORK_PERMIT_STATUSES)[number];

export type WorkPermitSummary = {
  id: string;
  memberId: string;
  memberName: string;
  memberEmail: string;
  divisionName: string | null;
  permitType: WorkPermitType;
  startDate: string;
  endDate: string;
  reason: string;
  status: WorkPermitStatus;
  currentApprovalLevel: number;
  reviewedAt: string | null;
  rejectionReason: string | null;
  proofUrl: string | null;
  hasProof: boolean;
  createdAt: string;
};

function assertReview(ctx: TenantContext): void {
  if (
    !ctx.permissions.includes("correction.review") &&
    !ctx.permissions.includes("member.manage") &&
    !ctx.roleKeys.includes("WORKSPACE_OWNER") &&
    !ctx.roleKeys.includes("WORKSPACE_ADMIN") &&
    !ctx.roleKeys.includes("HR")
  ) {
    throw new HttpError(403, "FORBIDDEN", "Permission tidak mencukupi");
  }
}

function assertFallbackApprover(ctx: TenantContext): void {
  if (
    !ctx.permissions.includes("correction.review") &&
    !ctx.permissions.includes("member.manage") &&
    !ctx.roleKeys.includes("WORKSPACE_OWNER") &&
    !ctx.roleKeys.includes("WORKSPACE_ADMIN") &&
    !ctx.roleKeys.includes("HR")
  ) {
    throw new HttpError(
      403,
      "APPROVAL_STEP_FORBIDDEN",
      "Tahap persetujuan ini bukan untuk role Anda",
    );
  }
}

function parseStatus(value: string | undefined): WorkPermitStatus | undefined {
  if (value === undefined || value.trim() === "") return undefined;
  const status = value.trim().toUpperCase();
  if (!(WORK_PERMIT_STATUSES as readonly string[]).includes(status)) {
    throw new HttpError(400, "INVALID_STATUS", "Status izin tidak valid");
  }
  return status as WorkPermitStatus;
}

function parseType(value: unknown): WorkPermitType {
  if (
    typeof value !== "string" ||
    !(WORK_PERMIT_TYPES as readonly string[]).includes(value.trim().toUpperCase())
  ) {
    throw new HttpError(400, "INVALID_PERMIT_TYPE", "Jenis izin kerja tidak valid");
  }
  return value.trim().toUpperCase() as WorkPermitType;
}

function day(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function toSummary(row: {
  id: string;
  memberId: string;
  permitType: string;
  startDate: Date;
  endDate: Date;
  reason: string;
  status: string;
  currentApprovalLevel: number;
  reviewedAt: Date | null;
  rejectionReason: string | null;
  proofFileName: string | null;
  createdAt: Date;
  member: {
    user: { name: string; email: string };
    division: { name: string } | null;
  };
}): WorkPermitSummary {
  return {
    id: row.id,
    memberId: row.memberId,
    memberName: row.member.user.name,
    memberEmail: row.member.user.email,
    divisionName: row.member.division?.name ?? null,
    permitType: row.permitType as WorkPermitType,
    startDate: day(row.startDate),
    endDate: day(row.endDate),
    reason: row.reason,
    status: row.status as WorkPermitStatus,
    currentApprovalLevel: row.currentApprovalLevel,
    reviewedAt: row.reviewedAt ? row.reviewedAt.toISOString() : null,
    rejectionReason: row.rejectionReason,
    proofUrl: row.proofFileName ? `/api/permits/${row.id}/proof` : null,
    hasProof: Boolean(row.proofFileName),
    createdAt: row.createdAt.toISOString(),
  };
}

const INCLUDE = {
  member: {
    include: {
      user: { select: { name: true, email: true } },
      division: { select: { name: true } },
    },
  },
} as const;

export async function submitWorkPermit(input: {
  ctx: TenantContext;
  body: Record<string, unknown>;
  proof?: PermitProofInput | undefined;
  ip?: string | null;
  userAgent?: string | null;
  now?: Date;
}): Promise<WorkPermitSummary> {
  const permitType = parseType(input.body.permitType);
  const startDate = parseReportDay(
    typeof input.body.startDate === "string" ? input.body.startDate : "",
    "startDate",
  );
  const endDate = parseReportDay(
    typeof input.body.endDate === "string" ? input.body.endDate : "",
    "endDate",
  );
  if (endDate.getTime() < startDate.getTime()) {
    throw new HttpError(400, "INVALID_DATE_RANGE", "Tanggal selesai tidak boleh sebelum mulai");
  }
  if ((endDate.getTime() - startDate.getTime()) / 86_400_000 > 31) {
    throw new HttpError(400, "INVALID_DATE_RANGE", "Rentang izin maksimal 32 hari");
  }
  const reason =
    typeof input.body.reason === "string" ? input.body.reason.trim() : "";
  if (reason.length < PERMIT_REASON_MIN_LENGTH || reason.length > PERMIT_REASON_MAX_LENGTH) {
    throw new HttpError(
      400,
      "INVALID_REASON",
      `Alasan izin ${PERMIT_REASON_MIN_LENGTH}-${PERMIT_REASON_MAX_LENGTH} karakter`,
    );
  }

  const id = randomUUID();
  const proof = input.proof
    ? await storePermitProof(id, input.proof)
    : { proofHash: null, proofFileName: null, proofContentType: null };

  const created = await withTenant(input.ctx, (db) =>
    db.$transaction(async (tx) => {
      const overlap = await tx.workPermit.findFirst({
        where: {
          memberId: input.ctx.memberId,
          status: { in: ["PENDING", "APPROVED"] },
          startDate: { lte: endDate },
          endDate: { gte: startDate },
        },
        select: { id: true },
      });
      if (overlap) {
        throw new HttpError(409, "PERMIT_OVERLAP", "Sudah ada izin pada rentang tanggal ini");
      }
      const row = await tx.workPermit.create({
        data: {
          id,
          tenantId: input.ctx.tenantId,
          memberId: input.ctx.memberId,
          permitType,
          startDate,
          endDate,
          reason,
          proofUrl: proof.proofFileName ? `/api/permits/${id}/proof` : null,
          proofHash: proof.proofHash,
          proofFileName: proof.proofFileName,
          proofContentType: proof.proofContentType,
        },
        include: INCLUDE,
      });
      await writeAudit(
        {
          tenantId: input.ctx.tenantId,
          actorType: "USER",
          actorUserId: input.ctx.userId,
          actorMemberId: input.ctx.memberId,
          action: "permit.request",
          resourceType: "work_permit",
          resourceId: id,
          metadata: {
            permitType,
            startDate: day(startDate),
            endDate: day(endDate),
            reasonLength: reason.length,
            hasProof: Boolean(proof.proofFileName),
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

export async function listMyWorkPermits(input: {
  ctx: TenantContext;
  status?: string | undefined;
}): Promise<WorkPermitSummary[]> {
  const status = parseStatus(input.status);
  const rows = await withTenant(input.ctx, (db) =>
    db.workPermit.findMany({
      where: {
        memberId: input.ctx.memberId,
        ...(status ? { status } : {}),
      },
      include: INCLUDE,
      orderBy: [{ startDate: "desc" }, { createdAt: "desc" }],
    }),
  );
  return rows.map(toSummary);
}

export async function listWorkspaceWorkPermits(input: {
  ctx: TenantContext;
  workspaceId: string;
  status?: string | undefined;
  memberId?: string | undefined;
}): Promise<WorkPermitSummary[]> {
  assertReview(input.ctx);
  assertWorkspaceReadClaim(input.ctx, input.workspaceId);
  if (input.memberId && !isUuid(input.memberId)) {
    throw new HttpError(400, "INVALID_MEMBER", "Member tidak valid");
  }
  const status = parseStatus(input.status);
  const rows = await withTenant(input.ctx, (db) =>
    db.workPermit.findMany({
      where: {
        ...(status ? { status } : {}),
        ...(input.memberId ? { memberId: input.memberId } : {}),
      },
      include: INCLUDE,
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: 200,
    }),
  );
  return rows.map(toSummary);
}

export async function reviewWorkPermit(input: {
  ctx: TenantContext;
  workspaceId?: string | undefined;
  permitId: string;
  action: string;
  rejectionReason?: string | undefined;
  ip?: string | null;
  userAgent?: string | null;
  now?: Date;
}): Promise<WorkPermitSummary> {
  assertReview(input.ctx);
  if (input.workspaceId) assertWorkspaceReadClaim(input.ctx, input.workspaceId);
  if (!isUuid(input.permitId)) {
    throw new HttpError(400, "INVALID_PERMIT", "Izin kerja tidak valid");
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
  const now = input.now ?? new Date();

  const updated = await withTenant(input.ctx, (db) =>
    db.$transaction(async (tx) => {
      const existing = await tx.workPermit.findFirst({
        where: { id: input.permitId },
        include: INCLUDE,
      });
      if (!existing) {
        throw new HttpError(404, "PERMIT_NOT_FOUND", "Izin kerja tidak ditemukan");
      }
      if (existing.status !== "PENDING") {
        throw new HttpError(409, "ALREADY_REVIEWED", "Izin kerja sudah direview");
      }

      let status: WorkPermitStatus = "APPROVED";
      let nextLevel = existing.currentApprovalLevel;
      if (action === "APPROVE") {
        const resolved = await resolveApprovalStep(
          tx,
          input.ctx.tenantId,
          "PERMIT",
          existing.currentApprovalLevel,
        );
        if (resolved?.step) {
          assertApprovalActor({ ctx: input.ctx, step: resolved.step });
          nextLevel = resolved.step.level;
          if (resolved.step.level < resolved.totalSteps) status = "PENDING";
        } else if (resolved) {
          nextLevel = resolved.totalSteps;
        } else {
          assertFallbackApprover(input.ctx);
        }
      } else {
        status = "REJECTED";
      }

      const row = await tx.workPermit.update({
        where: { tenantId_id: { tenantId: input.ctx.tenantId, id: existing.id } },
        data: {
          status,
          currentApprovalLevel: nextLevel,
          reviewedByMemberId: input.ctx.memberId,
          reviewedAt: now,
          rejectionReason: action === "REJECT" ? rejectionReason : null,
        },
        include: INCLUDE,
      });
      await createInAppNotification(tx, {
        tenantId: input.ctx.tenantId,
        memberId: existing.memberId,
        type:
          status === "PENDING"
            ? "PERMIT_NEXT_APPROVAL"
            : action === "REJECT"
              ? "PERMIT_REJECTED"
              : "PERMIT_APPROVED",
        title:
          status === "PENDING"
            ? "Izin kerja menunggu level berikutnya"
            : action === "REJECT"
              ? "Izin kerja ditolak"
              : "Izin kerja disetujui",
        body:
          status === "PENDING"
            ? "Pengajuan izin Anda sudah disetujui pada level ini dan diteruskan ke approver berikutnya."
            : action === "REJECT"
              ? "Buka riwayat izin untuk melihat alasan penolakan."
              : "Pengajuan izin kerja Anda sudah disetujui penuh.",
        linkUrl: `/workspaces/${input.ctx.tenantId}/permits`,
      });
      await writeAudit(
        {
          tenantId: input.ctx.tenantId,
          actorType: "USER",
          actorUserId: input.ctx.userId,
          actorMemberId: input.ctx.memberId,
          action:
            action === "REJECT"
              ? "permit.reject"
              : status === "PENDING"
                ? "permit.step"
                : "permit.approve",
          resourceType: "work_permit",
          resourceId: existing.id,
          metadata: {
            memberId: existing.memberId,
            status,
            level: nextLevel,
            ...(action === "REJECT" ? { reasonLength: rejectionReason.length } : {}),
          },
          ip: input.ip ?? null,
          userAgent: input.userAgent ?? null,
        },
        tx,
      );
      return row;
    }),
  );
  return toSummary(updated);
}
