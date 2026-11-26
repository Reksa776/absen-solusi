import { randomUUID } from "node:crypto";

import {
  createTenantContext,
  isUuid,
  withTenant,
  writeAudit,
  type Prisma,
  type TenantContext,
} from "@absensi/database";

import { HttpError } from "./http.js";
import { createInAppNotification } from "./inbox.js";
import { sendPushNotificationToMember } from "./push-notifications.js";
import { assertWorkspaceReadClaim } from "./workspaces.js";

export const MEMBER_DEVICE_PLATFORMS = ["ANDROID", "IOS", "UNKNOWN"] as const;
export type MemberDevicePlatform = (typeof MEMBER_DEVICE_PLATFORMS)[number];
export const DEVICE_ID_MIN_LENGTH = 8;
export const DEVICE_ID_MAX_LENGTH = 128;
export const DEVICE_STATUSES = ["PENDING", "APPROVED", "REVOKED"] as const;
export type DeviceStatus = (typeof DEVICE_STATUSES)[number];

export type DeviceIdentity = {
  deviceId: string;
  deviceName: string;
  platform: MemberDevicePlatform;
  deviceModel?: string | null;
  deviceManufacturer?: string | null;
};

export type MemberDeviceSummary = {
  id: string;
  memberId: string;
  deviceId: string;
  deviceName: string;
  platform: MemberDevicePlatform;
  status: DeviceStatus;
  lastSeenAt: string;
  approvedByMemberId: string | null;
  approvedAt: string | null;
  revokedAt: string | null;
};

export type AdminDeviceSummary = MemberDeviceSummary & {
  member: { id: string; name: string; email: string };
};

export type MobileDeviceSettings = {
  requireDeviceApproval: boolean;
  autoApproveFirstDevice: boolean;
};

function canReview(ctx: TenantContext): boolean {
  return (
    ctx.permissions.includes("correction.review") ||
    ctx.permissions.includes("member.manage") ||
    ctx.roleKeys.includes("WORKSPACE_OWNER") ||
    ctx.roleKeys.includes("WORKSPACE_ADMIN")
  );
}

function assertReview(ctx: TenantContext): void {
  if (!canReview(ctx) && !ctx.permissions.includes("member.manage")) {
    throw new HttpError(403, "FORBIDDEN", "Permission tidak mencukupi");
  }
}

function assertDeviceRead(ctx: TenantContext): void {
  if (!canReview(ctx) && !ctx.permissions.includes("member.read")) {
    throw new HttpError(403, "FORBIDDEN", "Permission tidak mencukupi");
  }
}

function normalizePlatform(value: string | null | undefined): MemberDevicePlatform {
  const platform = (value ?? "").trim().toUpperCase();
  return (MEMBER_DEVICE_PLATFORMS as readonly string[]).includes(platform)
    ? (platform as MemberDevicePlatform)
    : "UNKNOWN";
}

function defaultDeviceName(platform: MemberDevicePlatform): string {
  if (platform === "ANDROID") return "Android";
  if (platform === "IOS") return "iOS";
  return "Perangkat";
}

export function normalizeDeviceIdentity(input: {
  deviceId?: string | null;
  deviceName?: string | null;
  platform?: string | null;
  deviceModel?: string | null;
  deviceManufacturer?: string | null;
}): DeviceIdentity | null {
  const deviceId = input.deviceId?.trim() ?? "";
  if (!deviceId) return null;
  if (deviceId.length < DEVICE_ID_MIN_LENGTH || deviceId.length > DEVICE_ID_MAX_LENGTH) {
    throw new HttpError(400, "INVALID_DEVICE", "Identitas perangkat tidak valid");
  }
  const platform = normalizePlatform(input.platform);
  return {
    deviceId,
    deviceName: (input.deviceName?.trim() || defaultDeviceName(platform)).slice(0, 120),
    platform,
    deviceModel: input.deviceModel?.trim().slice(0, 120) || null,
    deviceManufacturer: input.deviceManufacturer?.trim().slice(0, 120) || null,
  };
}

function toSummary(row: {
  id: string;
  memberId: string;
  deviceId: string;
  deviceName: string;
  platform: string;
  status: string;
  lastSeenAt: Date;
  approvedByMemberId: string | null;
  approvedAt: Date | null;
  revokedAt: Date | null;
}): MemberDeviceSummary {
  return {
    id: row.id,
    memberId: row.memberId,
    deviceId: row.deviceId,
    deviceName: row.deviceName,
    platform: normalizePlatform(row.platform),
    status: row.status as DeviceStatus,
    lastSeenAt: row.lastSeenAt.toISOString(),
    approvedByMemberId: row.approvedByMemberId,
    approvedAt: row.approvedAt ? row.approvedAt.toISOString() : null,
    revokedAt: row.revokedAt ? row.revokedAt.toISOString() : null,
  };
}

async function ensureDevice(
  tx: Prisma.TransactionClient,
  input: {
    tenantId: string;
    memberId: string;
    identity: DeviceIdentity;
    now: Date;
  },
): Promise<{ row: MemberDeviceSummary; created: boolean }> {
  const existing = await tx.memberDevice.findFirst({
    where: {
      tenantId: input.tenantId,
      memberId: input.memberId,
      deviceId: input.identity.deviceId,
    },
  });
  if (existing) {
    const updated = await tx.memberDevice.update({
      where: { tenantId_id: { tenantId: input.tenantId, id: existing.id } },
      data: {
        deviceName: input.identity.deviceName,
        platform: input.identity.platform,
        lastSeenAt: input.now,
      },
    });
    return { row: toSummary(updated), created: false };
  }

  const workspace = await tx.workspace.findFirst({
    where: { id: input.tenantId },
    select: { requireDeviceApproval: true, autoApproveFirstDevice: true },
  });
  // Kebijakan "perangkat pertama" dihitung dari seluruh riwayat perangkat,
  // termasuk yang sudah dicabut, agar perangkat baru tidak otomatis lolos
  // setelah reset.
  const deviceCount = await tx.memberDevice.count({
    where: { tenantId: input.tenantId, memberId: input.memberId },
  });
  const firstDevice = deviceCount === 0;
  const autoApprove =
    workspace?.requireDeviceApproval === false ||
    (firstDevice && workspace?.autoApproveFirstDevice !== false);
  const status: DeviceStatus = autoApprove ? "APPROVED" : "PENDING";
  const created = await tx.memberDevice.create({
    data: {
      id: randomUUID(),
      tenantId: input.tenantId,
      memberId: input.memberId,
      deviceId: input.identity.deviceId,
      deviceName: input.identity.deviceName,
      platform: input.identity.platform,
      status,
      lastSeenAt: input.now,
      approvedAt: autoApprove ? input.now : null,
    },
  });
  return { row: toSummary(created), created: true };
}

export async function registerLoginDevice(input: {
  tenantId: string;
  userId: string;
  memberId: string;
  identity: DeviceIdentity;
  ip?: string | null;
  userAgent?: string | null;
  now?: Date;
}): Promise<MemberDeviceSummary> {
  const now = input.now ?? new Date();
  const ctx = createTenantContext({
    tenantId: input.tenantId,
    userId: input.userId,
    memberId: input.memberId,
    roleKeys: [],
    permissions: [],
  });
  return withTenant(ctx, (db) =>
    db.$transaction(async (tx) => {
      const { row, created } = await ensureDevice(tx, {
        tenantId: input.tenantId,
        memberId: input.memberId,
        identity: input.identity,
        now,
      });
      if (created) {
        await writeAudit(
          {
            tenantId: input.tenantId,
            actorType: "USER",
            actorUserId: input.userId,
            actorMemberId: input.memberId,
            action: "device.register",
            resourceType: "member_device",
            resourceId: row.id,
            metadata: { platform: row.platform, status: row.status },
            ip: input.ip ?? null,
            userAgent: input.userAgent ?? null,
          },
          tx,
        );
      }
      return row;
    }),
  );
}

/** Dipanggil sebelum absensi. Tanpa header perangkat, klien lama tetap diizinkan. */
export async function assertAttendanceDevice(input: {
  ctx: TenantContext;
  identity: DeviceIdentity | null;
  ip?: string | null;
  userAgent?: string | null;
}): Promise<MemberDeviceSummary | null> {
  if (!input.identity) return null;
  const identity = input.identity;
  const now = new Date();
  // Simpan/refresh perangkat di transaksi yang commit. Error 403 dilempar
  // setelah transaksi selesai agar perangkat PENDING tetap masuk antrean admin.
  const row = await withTenant(input.ctx, (db) =>
    db.$transaction(async (tx) => {
      const result = await ensureDevice(tx, {
        tenantId: input.ctx.tenantId,
        memberId: input.ctx.memberId,
        identity,
        now,
      });
      return result.row;
    }),
  );
  if (row.status === "PENDING") {
    throw new HttpError(
      403,
      "DEVICE_PENDING_APPROVAL",
      "Perangkat baru menunggu persetujuan Admin HR",
    );
  }
  if (row.status === "REVOKED") {
    throw new HttpError(
      403,
      "DEVICE_REVOKED",
      "Perangkat ini sudah direset. Minta Admin HR mengaktifkan perangkat baru.",
    );
  }
  return row;
}

export async function getMyDevice(input: {
  ctx: TenantContext;
  identity: DeviceIdentity | null;
}): Promise<MemberDeviceSummary | null> {
  const deviceId = input.identity?.deviceId;
  if (!deviceId) return null;
  const row = await withTenant(input.ctx, (db) =>
    db.memberDevice.findFirst({
      where: { memberId: input.ctx.memberId, deviceId },
    }),
  );
  return row ? toSummary(row) : null;
}

export async function listMemberDevices(input: {
  ctx: TenantContext;
  workspaceId: string;
  status?: string | undefined;
  search?: string | undefined;
}): Promise<AdminDeviceSummary[]> {
  assertDeviceRead(input.ctx);
  assertWorkspaceReadClaim(input.ctx, input.workspaceId);
  const status = input.status?.trim().toUpperCase();
  if (status && !(DEVICE_STATUSES as readonly string[]).includes(status)) {
    throw new HttpError(400, "INVALID_STATUS", "Status perangkat tidak valid");
  }
  const search = input.search?.trim();
  if (search !== undefined && search.length > 120) {
    throw new HttpError(400, "INVALID_SEARCH", "Pencarian terlalu panjang");
  }
  const rows = await withTenant(input.ctx, (db) =>
    db.memberDevice.findMany({
      where: {
        ...(status ? { status } : {}),
        ...(search
          ? {
              OR: [
                { deviceName: { contains: search } },
                { deviceId: { contains: search } },
                { member: { user: { name: { contains: search } } } },
                { member: { user: { email: { contains: search } } } },
              ],
            }
          : {}),
      },
      include: { member: { include: { user: { select: { id: true, name: true, email: true } } } } },
      orderBy: [{ status: "asc" }, { lastSeenAt: "desc" }],
      take: 200,
    }),
  );
  return rows.map((row) => ({
    ...toSummary(row),
    member: { id: row.member.id, name: row.member.user.name, email: row.member.user.email },
  }));
}

type ReviewAction = "APPROVE" | "REJECT" | "REVOKE" | "RESET";

function normalizeReviewAction(value: string): ReviewAction {
  const action = value.trim().toUpperCase();
  if (!["APPROVE", "REJECT", "REVOKE", "RESET"].includes(action)) {
    throw new HttpError(
      400,
      "INVALID_ACTION",
      "Action harus APPROVE, REJECT, REVOKE, atau RESET",
    );
  }
  return action === "RESET" ? "REVOKE" : (action as ReviewAction);
}

export async function reviewMemberDevice(input: {
  ctx: TenantContext;
  workspaceId: string;
  deviceId: string;
  action: string;
  ip?: string | null;
  userAgent?: string | null;
  now?: Date;
}): Promise<MemberDeviceSummary> {
  assertReview(input.ctx);
  assertWorkspaceReadClaim(input.ctx, input.workspaceId);
  if (!isUuid(input.deviceId)) {
    throw new HttpError(400, "INVALID_DEVICE", "Perangkat tidak valid");
  }
  const action = normalizeReviewAction(input.action);
  const now = input.now ?? new Date();

  const summary = await withTenant(input.ctx, (db) =>
    db.$transaction(async (tx) => {
      const device = await tx.memberDevice.findFirst({
        where: { id: input.deviceId },
        include: { member: { include: { user: { select: { name: true } } } } },
      });
      if (!device) {
        throw new HttpError(404, "DEVICE_NOT_FOUND", "Perangkat tidak ditemukan");
      }
      if (action === "APPROVE" && device.status === "APPROVED") {
        return toSummary(device);
      }
      if (action === "REJECT" && device.status === "REVOKED") {
        throw new HttpError(409, "DEVICE_ALREADY_REVOKED", "Perangkat sudah dicabut");
      }
      if (action === "REVOKE" && device.status !== "APPROVED") {
        throw new HttpError(409, "DEVICE_NOT_ACTIVE", "Hanya perangkat aktif dapat dicabut");
      }

      const approving = action === "APPROVE";
      const rejectedPending = action === "REJECT" && device.status === "PENDING";
      const status: DeviceStatus = approving ? "APPROVED" : "REVOKED";
      const auditAction = approving
        ? "device.approve"
        : rejectedPending
          ? "device.reject"
          : "device.revoke";
      const updated = await tx.memberDevice.update({
        where: { tenantId_id: { tenantId: input.ctx.tenantId, id: device.id } },
        data: {
          status,
          approvedByMemberId: approving ? input.ctx.memberId : device.approvedByMemberId,
          approvedAt: approving ? now : device.approvedAt,
          revokedAt: approving ? null : now,
        },
      });

      await createInAppNotification(tx, {
        tenantId: input.ctx.tenantId,
        memberId: device.memberId,
        type: approving ? "DEVICE_APPROVED" : rejectedPending ? "DEVICE_REJECTED" : "DEVICE_REVOKED",
        title: approving
          ? `Perangkat ${device.deviceName} disetujui`
          : rejectedPending
            ? `Perangkat ${device.deviceName} ditolak`
            : `Perangkat ${device.deviceName} dicabut`,
        body: approving
          ? `Perangkat ${device.deviceName} sekarang dapat digunakan untuk absensi.`
          : rejectedPending
            ? `Permintaan perangkat ${device.deviceName} ditolak Admin/HR. Hubungi Admin HR bila ini perangkat resmi Anda.`
            : `Perangkat ${device.deviceName} tidak lagi diizinkan untuk absensi. Login dari perangkat baru untuk meminta persetujuan.`,
        linkUrl: `/workspaces/${input.ctx.tenantId}/devices`,
      });
      await writeAudit(
        {
          tenantId: input.ctx.tenantId,
          actorType: "USER",
          actorUserId: input.ctx.userId,
          actorMemberId: input.ctx.memberId,
          action: auditAction,
          resourceType: "member_device",
          resourceId: device.id,
          metadata: {
            memberId: device.memberId,
            platform: normalizePlatform(device.platform),
            status,
          },
          ip: input.ip ?? null,
          userAgent: input.userAgent ?? null,
        },
        tx,
      );
      return toSummary(updated);
    }),
  );

  const approving = action === "APPROVE";
  const rejected = action === "REJECT";
  await sendPushNotificationToMember({
    ctx: input.ctx,
    memberId: summary.memberId,
    message: {
      title: approving
        ? `Perangkat ${summary.deviceName} disetujui`
        : rejected
          ? `Perangkat ${summary.deviceName} ditolak`
          : `Perangkat ${summary.deviceName} dicabut`,
      body: approving
        ? "Perangkat Anda sekarang dapat digunakan untuk absensi."
        : rejected
          ? "Permintaan perangkat Anda ditolak Admin/HR. Hubungi Admin HR bila ini perangkat resmi Anda."
          : "Perangkat Anda tidak lagi diizinkan untuk absensi. Login dari perangkat baru untuk meminta persetujuan.",
      data: {
        type: approving ? "device_approved" : rejected ? "device_rejected" : "device_revoked",
        deviceId: summary.id,
        status: summary.status,
      },
    },
  });
  return summary;
}

export async function resetMemberDevices(input: {
  ctx: TenantContext;
  workspaceId: string;
  memberId: string;
  ip?: string | null;
  userAgent?: string | null;
  now?: Date;
}): Promise<{ memberId: string; resetCount: number }> {
  assertReview(input.ctx);
  assertWorkspaceReadClaim(input.ctx, input.workspaceId);
  if (!isUuid(input.memberId)) {
    throw new HttpError(400, "INVALID_MEMBER", "Member tidak valid");
  }
  const now = input.now ?? new Date();
  return withTenant(input.ctx, (db) =>
    db.$transaction(async (tx) => {
      const member = await tx.workspaceMember.findFirst({
        where: { id: input.memberId },
        include: { user: { select: { name: true } } },
      });
      if (!member) {
        throw new HttpError(404, "MEMBER_NOT_FOUND", "Member tidak ditemukan");
      }
      const active = await tx.memberDevice.findMany({
        where: { memberId: member.id, status: { in: ["PENDING", "APPROVED"] } },
        select: { id: true },
      });
      if (active.length === 0) {
        return { memberId: member.id, resetCount: 0 };
      }
      await tx.memberDevice.updateMany({
        where: { memberId: member.id, id: { in: active.map((row) => row.id) } },
        data: { status: "REVOKED", revokedAt: now },
      });
      await createInAppNotification(tx, {
        tenantId: input.ctx.tenantId,
        memberId: member.id,
        type: "DEVICE_RESET",
        title: "Semua perangkat direset",
        body: "Admin HR mencabut seluruh perangkat aktif. Login dari perangkat baru untuk meminta persetujuan.",
        linkUrl: `/workspaces/${input.ctx.tenantId}/devices`,
      });
      await writeAudit(
        {
          tenantId: input.ctx.tenantId,
          actorType: "USER",
          actorUserId: input.ctx.userId,
          actorMemberId: input.ctx.memberId,
          action: "device.reset",
          resourceType: "workspace_member",
          resourceId: member.id,
          metadata: { memberId: member.id, resetCount: active.length },
          ip: input.ip ?? null,
          userAgent: input.userAgent ?? null,
        },
        tx,
      );
      return { memberId: member.id, resetCount: active.length };
    }),
  );
}

export async function getMobileSettings(input: {
  ctx: TenantContext;
  workspaceId: string;
}): Promise<MobileDeviceSettings> {
  if (!input.ctx.permissions.includes("member.read")) {
    throw new HttpError(403, "FORBIDDEN", "Permission tidak mencukupi");
  }
  assertWorkspaceReadClaim(input.ctx, input.workspaceId);
  const workspace = await withTenant(input.ctx, (db) =>
    db.workspace.findFirst({
      where: { id: input.ctx.tenantId },
      select: { requireDeviceApproval: true, autoApproveFirstDevice: true },
    }),
  );
  return {
    requireDeviceApproval: workspace?.requireDeviceApproval ?? true,
    autoApproveFirstDevice: workspace?.autoApproveFirstDevice ?? true,
  };
}

export async function updateMobileSettings(input: {
  ctx: TenantContext;
  workspaceId: string;
  requireDeviceApproval?: boolean | undefined;
  autoApproveFirstDevice?: boolean | undefined;
  ip?: string | null;
  userAgent?: string | null;
}): Promise<MobileDeviceSettings> {
  if (!input.ctx.permissions.includes("member.manage")) {
    throw new HttpError(403, "FORBIDDEN", "Permission tidak mencukupi");
  }
  assertWorkspaceReadClaim(input.ctx, input.workspaceId);
  if (
    input.requireDeviceApproval === undefined &&
    input.autoApproveFirstDevice === undefined
  ) {
    throw new HttpError(400, "INVALID_INPUT", "Minimal satu pengaturan harus diisi");
  }
  const workspace = await withTenant(input.ctx, (db) =>
    db.$transaction(async (tx) => {
      const row = await tx.workspace.update({
        where: { id: input.ctx.tenantId },
        data: {
          ...(input.requireDeviceApproval === undefined
            ? {}
            : { requireDeviceApproval: input.requireDeviceApproval }),
          ...(input.autoApproveFirstDevice === undefined
            ? {}
            : { autoApproveFirstDevice: input.autoApproveFirstDevice }),
        },
        select: { requireDeviceApproval: true, autoApproveFirstDevice: true },
      });
      await writeAudit(
        {
          tenantId: input.ctx.tenantId,
          actorType: "USER",
          actorUserId: input.ctx.userId,
          actorMemberId: input.ctx.memberId,
          action: "workspace.mobile_settings_update",
          resourceType: "workspace",
          resourceId: input.ctx.tenantId,
          metadata: {
            requireDeviceApproval: row.requireDeviceApproval,
            autoApproveFirstDevice: row.autoApproveFirstDevice,
          },
          ip: input.ip ?? null,
          userAgent: input.userAgent ?? null,
        },
        tx,
      );
      return row;
    }),
  );
  return workspace;
}
