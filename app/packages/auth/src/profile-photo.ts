import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { withTenant, writeAudit, type TenantContext } from "@absensi/database";

import { HttpError } from "./http.js";
import { createInAppNotification } from "./inbox.js";
import { assertWorkspaceReadClaim } from "./workspaces.js";

export const MAX_PROFILE_PHOTO_BYTES = 5 * 1024 * 1024;
export const PROFILE_PHOTO_STATUSES = ["NONE", "PENDING", "APPROVED", "REJECTED"] as const;
export type ProfilePhotoStatus = (typeof PROFILE_PHOTO_STATUSES)[number];

export type ProfilePhotoInput = {
  bytes: Uint8Array;
  filename: string;
  contentType: string;
};

export type ProfilePhotoSummary = {
  memberId: string;
  memberName: string;
  memberEmail: string;
  divisionName: string | null;
  positionName: string | null;
  photoUrl: string | null;
  photoStatus: ProfilePhotoStatus;
  photoSubmittedAt: string | null;
  photoReviewedAt: string | null;
  photoRejectionReason: string | null;
};

function canReview(ctx: TenantContext): boolean {
  return (
    ctx.permissions.includes("correction.review") ||
    ctx.permissions.includes("member.manage") ||
    ctx.roleKeys.includes("WORKSPACE_OWNER") ||
    ctx.roleKeys.includes("WORKSPACE_ADMIN")
  );
}

export function profilePhotoDirectory(env: NodeJS.ProcessEnv = process.env): string {
  return env.PROFILE_PHOTO_DIR ?? join(process.cwd(), "storage", "profile-photos");
}

export function profilePhotoContentType(bytes: Uint8Array): string | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
    return "image/png";
  }
  if (
    bytes.length >= 12 &&
    String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" &&
    String.fromCharCode(...bytes.slice(8, 12)) === "WEBP"
  ) {
    return "image/webp";
  }
  return null;
}

function normalizeStatus(value: string | undefined): ProfilePhotoStatus | undefined {
  const status = value?.trim().toUpperCase();
  if (!status) return undefined;
  if (!(PROFILE_PHOTO_STATUSES as readonly string[]).includes(status)) {
    throw new HttpError(400, "INVALID_STATUS", "Status foto tidak valid");
  }
  return status as ProfilePhotoStatus;
}

export async function submitProfilePhoto(input: {
  ctx: TenantContext;
  workspaceId: string;
  photo: ProfilePhotoInput;
  ip?: string | null;
  userAgent?: string | null;
}): Promise<{ status: ProfilePhotoStatus; photoUrl: string }> {
  if (!input.ctx.permissions.includes("workspace.read")) {
    throw new HttpError(403, "FORBIDDEN", "Permission tidak mencukupi");
  }
  assertWorkspaceReadClaim(input.ctx, input.workspaceId);
  if (
    input.photo.bytes.byteLength === 0 ||
    input.photo.bytes.byteLength > MAX_PROFILE_PHOTO_BYTES
  ) {
    throw new HttpError(400, "INVALID_PROFILE_PHOTO", "Foto wajib dan maksimal 5 MB");
  }
  const contentType = profilePhotoContentType(input.photo.bytes);
  if (!contentType) {
    throw new HttpError(400, "INVALID_PROFILE_PHOTO", "Foto harus JPEG, PNG, atau WebP");
  }
  const dir = profilePhotoDirectory();
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, input.ctx.memberId), input.photo.bytes);
  const photoUrl = `/api/workspaces/${input.ctx.tenantId}/members/${input.ctx.memberId}/photo`;
  await withTenant(input.ctx, (db) =>
    db.$transaction(async (tx) => {
      await tx.workspaceMember.update({
        where: {
          tenantId_id: { tenantId: input.ctx.tenantId, id: input.ctx.memberId },
        },
        data: {
          photoUrl,
          photoStatus: "PENDING",
          photoSubmittedAt: new Date(),
          photoReviewedAt: null,
          photoReviewedByMemberId: null,
          photoRejectionReason: null,
        },
      });
      await writeAudit(
        {
          tenantId: input.ctx.tenantId,
          actorType: "USER",
          actorUserId: input.ctx.userId,
          actorMemberId: input.ctx.memberId,
          action: "member.photo_submit",
          resourceType: "workspace_member",
          resourceId: input.ctx.memberId,
          metadata: { contentType, size: input.photo.bytes.byteLength },
          ip: input.ip ?? null,
          userAgent: input.userAgent ?? null,
        },
        tx,
      );
    }),
  );
  return { status: "PENDING", photoUrl };
}

export async function readProfilePhoto(input: {
  ctx: TenantContext;
  workspaceId: string;
  memberId: string;
}): Promise<{ bytes: Uint8Array; contentType: string }> {
  assertWorkspaceReadClaim(input.ctx, input.workspaceId);
  const isSelf = input.ctx.memberId === input.memberId;
  if (!isSelf && !canReview(input.ctx)) {
    throw new HttpError(403, "FORBIDDEN", "Foto tidak dapat diakses");
  }
  const member = await withTenant(input.ctx, (db) =>
    db.workspaceMember.findFirst({
      where: { id: input.memberId },
      select: { photoUrl: true },
    }),
  );
  if (!member?.photoUrl) {
    throw new HttpError(404, "PROFILE_PHOTO_NOT_FOUND", "Foto profil belum tersedia");
  }
  let bytes: Uint8Array;
  try {
    bytes = await readFile(join(profilePhotoDirectory(), input.memberId));
  } catch {
    throw new HttpError(404, "PROFILE_PHOTO_NOT_FOUND", "Foto profil belum tersedia");
  }
  const contentType = profilePhotoContentType(bytes);
  if (!contentType) {
    throw new HttpError(404, "PROFILE_PHOTO_NOT_FOUND", "Foto profil tidak valid");
  }
  return { bytes, contentType };
}

type PhotoRow = {
  id: string;
  photoUrl: string | null;
  photoStatus: string;
  photoSubmittedAt: Date | null;
  photoReviewedAt: Date | null;
  photoRejectionReason: string | null;
  user: { name: string; email: string };
  division: { name: string } | null;
  position: { name: string } | null;
};

function toSummary(row: PhotoRow): ProfilePhotoSummary {
  return {
    memberId: row.id,
    memberName: row.user.name,
    memberEmail: row.user.email,
    divisionName: row.division?.name ?? null,
    positionName: row.position?.name ?? null,
    photoUrl: row.photoUrl,
    photoStatus: row.photoStatus as ProfilePhotoStatus,
    photoSubmittedAt: row.photoSubmittedAt ? row.photoSubmittedAt.toISOString() : null,
    photoReviewedAt: row.photoReviewedAt ? row.photoReviewedAt.toISOString() : null,
    photoRejectionReason: row.photoRejectionReason,
  };
}

const PHOTO_INCLUDE = {
  user: { select: { name: true, email: true } },
  division: { select: { name: true } },
  position: { select: { name: true } },
} as const;

export async function listProfilePhotos(input: {
  ctx: TenantContext;
  workspaceId: string;
  status?: string | undefined;
}): Promise<ProfilePhotoSummary[]> {
  if (!canReview(input.ctx)) {
    throw new HttpError(403, "FORBIDDEN", "Permission tidak mencukupi");
  }
  assertWorkspaceReadClaim(input.ctx, input.workspaceId);
  const status = input.status?.trim().toUpperCase() || "PENDING";
  const rows = await withTenant(input.ctx, (db) =>
    db.workspaceMember.findMany({
      where: {
        status: "ACTIVE",
        photoStatus: status,
      },
      include: PHOTO_INCLUDE,
      orderBy: [{ photoSubmittedAt: "asc" }, { createdAt: "asc" }],
      take: 200,
    }),
  );
  return rows.map(toSummary);
}

export async function reviewProfilePhoto(input: {
  ctx: TenantContext;
  workspaceId: string;
  memberId: string;
  action: string;
  rejectionReason?: string | undefined;
  ip?: string | null;
  userAgent?: string | null;
  now?: Date;
}): Promise<ProfilePhotoSummary> {
  if (!canReview(input.ctx)) {
    throw new HttpError(403, "FORBIDDEN", "Permission tidak mencukupi");
  }
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
      const member = await tx.workspaceMember.findFirst({
        where: { id: input.memberId },
        include: PHOTO_INCLUDE,
      });
      if (!member || !member.photoUrl) {
        throw new HttpError(404, "PROFILE_PHOTO_NOT_FOUND", "Foto profil tidak ditemukan");
      }
      if (member.photoStatus !== "PENDING") {
        throw new HttpError(409, "PHOTO_ALREADY_REVIEWED", "Foto sudah direview");
      }
      const updated = await tx.workspaceMember.update({
        where: { tenantId_id: { tenantId: input.ctx.tenantId, id: member.id } },
        data: {
          photoStatus: action === "APPROVE" ? "APPROVED" : "REJECTED",
          photoReviewedAt: now,
          photoReviewedByMemberId: input.ctx.memberId,
          photoRejectionReason: action === "REJECT" ? reason : null,
        },
        include: PHOTO_INCLUDE,
      });
      await createInAppNotification(tx, {
        tenantId: input.ctx.tenantId,
        memberId: member.id,
        type: action === "APPROVE" ? "PROFILE_PHOTO_APPROVED" : "PROFILE_PHOTO_REJECTED",
        title: action === "APPROVE" ? "Foto profil disetujui" : "Foto profil ditolak",
        body:
          action === "APPROVE"
            ? "Foto baseline Anda sudah diverifikasi."
            : "Unggah foto profil baru dari tab Profil.",
        linkUrl: `/workspaces/${input.ctx.tenantId}/profile-photos`,
      });
      await writeAudit(
        {
          tenantId: input.ctx.tenantId,
          actorType: "USER",
          actorUserId: input.ctx.userId,
          actorMemberId: input.ctx.memberId,
          action: action === "APPROVE" ? "member.photo_approve" : "member.photo_reject",
          resourceType: "workspace_member",
          resourceId: member.id,
          metadata: { status: updated.photoStatus, reasonLength: reason.length },
          ip: input.ip ?? null,
          userAgent: input.userAgent ?? null,
        },
        tx,
      );
      return toSummary(updated);
    }),
  );
}

export async function getMyProfilePhoto(input: {
  ctx: TenantContext;
}): Promise<{ status: ProfilePhotoStatus; photoUrl: string | null; rejectionReason: string | null }> {
  const member = await withTenant(input.ctx, (db) =>
    db.workspaceMember.findFirst({
      where: { id: input.ctx.memberId },
      select: { photoUrl: true, photoStatus: true, photoRejectionReason: true },
    }),
  );
  if (!member) {
    throw new HttpError(404, "MEMBER_NOT_FOUND", "Member tidak ditemukan");
  }
  return {
    status: member.photoStatus as ProfilePhotoStatus,
    photoUrl: member.photoUrl,
    rejectionReason: member.photoRejectionReason,
  };
}

export function profilePhotoFilename(memberId: string): string {
  return `${memberId}-${randomUUID()}.jpg`;
}
