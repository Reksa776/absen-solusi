import { randomUUID } from "node:crypto";

import { systemDb, withTenant, type TenantContext } from "@absensi/database";

import {
  appBaseUrl,
  createEmailTransportFromEnv,
  type EmailTransport,
} from "./email.js";
import { HttpError } from "./http.js";
import { logger } from "./logger.js";
import {
  createPushTransportFromEnv,
  type PushDeliveryResult,
  type PushMessage,
  type PushTransport,
} from "./push.js";
import { startOfUtcDay } from "./reports.js";

export const DEVICE_PLATFORMS = ["ANDROID", "IOS", "WEB"] as const;
export type DevicePlatform = (typeof DEVICE_PLATFORMS)[number];
export const DEVICE_TOKEN_MIN_LENGTH = 10;
export const DEVICE_TOKEN_MAX_LENGTH = 512;

export type CorrectionNotificationInput = {
  ctx: TenantContext;
  correctionId: string;
  transport?: EmailTransport | undefined;
  pushTransport?: PushTransport | undefined;
  baseUrl?: string | undefined;
};

export type NotificationOutcome = { delivered: boolean; pushed: number };

/**
 * Notifikasi hasil revisi bersifat best-effort: keputusan review sudah
 * ter-commit di transaksi, jadi kegagalan email/push tidak membatalkannya.
 * Kegagalan dicatat tanpa isi alasan penolakan, token, atau kredensial.
 */
export async function notifyCorrectionReviewed(
  input: CorrectionNotificationInput,
): Promise<NotificationOutcome> {
  const record = await withTenant(input.ctx, (db) =>
    db.correctionRequest.findFirst({
      where: { id: input.correctionId },
      include: {
        member: { include: { user: { select: { email: true, name: true } } } },
        workspace: { select: { name: true } },
      },
    }),
  );
  if (!record) {
    throw new HttpError(404, "CORRECTION_NOT_FOUND", "Revisi tidak ditemukan");
  }
  if (record.status !== "APPROVED" && record.status !== "REJECTED") {
    return { delivered: false, pushed: 0 };
  }

  const transport = input.transport ?? createEmailTransportFromEnv();
  const base = input.baseUrl ?? appBaseUrl();
  let delivered = false;
  try {
    await transport.sendCorrectionResult({
      to: record.member.user.email,
      recipientName: record.member.user.name,
      workspaceName: record.workspace.name,
      status: record.status,
      requestType: record.requestType,
      requestedTimestamp: record.requestedTimestamp,
      rejectionReason: record.rejectionReason,
      actionUrl: `${base}/workspaces/${record.tenantId}/corrections/${record.id}`,
    });
    delivered = true;
  } catch (error) {
    logger.error("correction notification failed", {
      correctionId: record.id,
      error,
    });
  }

  // Push tidak memuat alasan penolakan agar isi sensitif tidak tampil di lockscreen.
  const pushed = await sendPushToMember({
    ctx: input.ctx,
    memberId: record.memberId,
    message: {
      title: record.status === "APPROVED" ? "Revisi disetujui" : "Revisi ditolak",
      body:
        record.status === "APPROVED"
          ? "Data kehadiran Anda sudah diperbarui."
          : "Buka aplikasi untuk melihat detail penolakan.",
      data: { type: "correction_result", correctionId: record.id },
    },
    ...(input.pushTransport ? { transport: input.pushTransport } : {}),
  });

  return { delivered, pushed: pushed.delivered };
}

function normalizePlatform(value: string): DevicePlatform {
  const platform = value.trim().toUpperCase();
  if ((DEVICE_PLATFORMS as readonly string[]).includes(platform)) {
    return platform as DevicePlatform;
  }
  throw new HttpError(400, "INVALID_PLATFORM", "Platform harus ANDROID, IOS, atau WEB");
}

export type RegisterDeviceTokenInput = {
  ctx: TenantContext;
  token: string;
  platform: string;
};

export type RegisteredDeviceToken = {
  id: string;
  platform: DevicePlatform;
};

/** Token unik per tenant; pendaftaran ulang oleh member lain memindahkan pemilik. */
export async function registerDeviceToken(
  input: RegisterDeviceTokenInput,
): Promise<RegisteredDeviceToken> {
  const token = input.token.trim();
  if (token.length < DEVICE_TOKEN_MIN_LENGTH || token.length > DEVICE_TOKEN_MAX_LENGTH) {
    throw new HttpError(
      400,
      "INVALID_DEVICE_TOKEN",
      `Token perangkat harus ${DEVICE_TOKEN_MIN_LENGTH}-${DEVICE_TOKEN_MAX_LENGTH} karakter`,
    );
  }
  const platform = normalizePlatform(input.platform);
  const row = await withTenant(input.ctx, (db) =>
    db.deviceToken.upsert({
      where: { tenantId_token: { tenantId: input.ctx.tenantId, token } },
      create: {
        id: randomUUID(),
        tenantId: input.ctx.tenantId,
        memberId: input.ctx.memberId,
        token,
        platform,
      },
      update: { memberId: input.ctx.memberId, platform },
    }),
  );
  return { id: row.id, platform };
}

export type SendPushToMemberInput = {
  ctx: TenantContext;
  memberId: string;
  message: PushMessage;
  transport?: PushTransport | undefined;
};

export async function sendPushToMember(
  input: SendPushToMemberInput,
): Promise<PushDeliveryResult> {
  const tokens = await withTenant(input.ctx, (db) =>
    db.deviceToken.findMany({
      where: { memberId: input.memberId },
      select: { token: true },
    }),
  );
  if (tokens.length === 0) return { delivered: 0, failed: 0 };
  const transport = input.transport ?? createPushTransportFromEnv();
  try {
    return await transport.send(
      tokens.map((row) => row.token),
      input.message,
    );
  } catch (error) {
    logger.error("push send failed", { memberId: input.memberId, error });
    return { delivered: 0, failed: tokens.length };
  }
}

export type AttendanceReminderType = "CHECK_IN" | "CHECK_OUT" | "LATE";

export type AttendanceReminderInput = {
  date: Date;
  type: AttendanceReminderType;
  /** Bila diisi, job hanya memproses workspace tersebut (dipakai scheduler). */
  workspaceId?: string | undefined;
  /** Bila diisi, hanya member dengan shift tersebut (default atau tanggal) yang ditargetkan. */
  shiftId?: string | undefined;
  /** Fallback jam kantor: hanya member tanpa penugasan shift yang ditargetkan. */
  unassignedOnly?: boolean | undefined;
  transport?: PushTransport | undefined;
};

export type AttendanceReminderResult = {
  tenants: number;
  members: number;
  delivered: number;
  failed: number;
};

/**
 * SYSTEM: job terjadwal berjalan tanpa sesi user dan harus melintasi tenant.
 * Semua akses di bawah sengaja memakai systemDb (bukan withTenant) karena
 * tidak ada TenantContext yang sah; filter tenant tetap eksplisit per workspace.
 */
export async function sendAttendanceRemindersForDate(
  input: AttendanceReminderInput,
): Promise<AttendanceReminderResult> {
  if (input.type !== "CHECK_IN" && input.type !== "CHECK_OUT" && input.type !== "LATE") {
    throw new HttpError(400, "INVALID_REMINDER_TYPE", "Tipe reminder tidak valid");
  }
  const db = systemDb();
  const workDate = startOfUtcDay(input.date);
  const workspaces = await db.workspace.findMany({
    where: {
      status: "ACTIVE",
      ...(input.workspaceId ? { id: input.workspaceId } : {}),
    },
    select: { id: true, name: true },
  });
  const transport = input.transport ?? createPushTransportFromEnv();
  const result: AttendanceReminderResult = {
    tenants: workspaces.length,
    members: 0,
    delivered: 0,
    failed: 0,
  };

  for (const workspace of workspaces) {
    const tokens = await db.deviceToken.findMany({
      where: { tenantId: workspace.id },
      select: { token: true, memberId: true, member: { select: { status: true } } },
    });
    const active = tokens.filter((row) => row.member.status === "ACTIVE");
    if (active.length === 0) continue;

    let memberIds = [...new Set(active.map((row) => row.memberId))];
    if (input.unassignedOnly) {
      const assignments = await db.memberShift.findMany({
        where: {
          tenantId: workspace.id,
          OR: [{ workDate }, { workDate: null }],
          memberId: { in: memberIds },
        },
        select: { memberId: true },
      });
      const assigned = new Set(assignments.map((row) => row.memberId));
      memberIds = memberIds.filter((memberId) => !assigned.has(memberId));
    }
    if (input.shiftId) {
      const assignments = await db.memberShift.findMany({
        where: {
          tenantId: workspace.id,
          shiftId: input.shiftId,
          OR: [{ workDate }, { workDate: null }],
          memberId: { in: memberIds },
        },
        select: { memberId: true, workDate: true },
      });
      const dated = new Set(
        assignments.filter((row) => row.workDate).map((row) => row.memberId),
      );
      const defaults = new Set(
        assignments.filter((row) => !row.workDate).map((row) => row.memberId),
      );
      memberIds = memberIds.filter(
        (memberId) => dated.has(memberId) || defaults.has(memberId),
      );
    }
    // LATE juga menargetkan member yang belum check-in pada hari kerja tersebut.
    const attendanceType = input.type === "CHECK_OUT" ? "CHECK_OUT" : "CHECK_IN";
    const present = await db.attendanceLog.findMany({
      where: {
        tenantId: workspace.id,
        type: attendanceType,
        workDate,
        memberId: { in: memberIds },
      },
      select: { memberId: true },
    });
    const alreadyPresent = new Set(present.map((row) => row.memberId));

    for (const memberId of memberIds) {
      if (alreadyPresent.has(memberId)) continue;
      const memberTokens = active
        .filter((row) => row.memberId === memberId)
        .map((row) => row.token);
      if (memberTokens.length === 0) continue;
      result.members += 1;
      const copy =
        input.type === "CHECK_IN"
          ? {
              title: "Waktunya check-in",
              body: `Jangan lupa check-in di ${workspace.name}.`,
              dataType: "reminder_check_in",
            }
          : input.type === "LATE"
            ? {
                title: "Anda belum check-in",
                body: `Jam masuk ${workspace.name} sudah lewat. Segera check-in.`,
                dataType: "reminder_late",
              }
            : {
                title: "Waktunya check-out",
                body: `Jangan lupa check-out di ${workspace.name}.`,
                dataType: "reminder_check_out",
              };
      try {
        const delivery = await transport.send(memberTokens, {
          title: copy.title,
          body: copy.body,
          data: {
            type: copy.dataType,
            workDate: workDate.toISOString().slice(0, 10),
          },
        });
        result.delivered += delivery.delivered;
        result.failed += delivery.failed;
      } catch (error) {
        result.failed += memberTokens.length;
        logger.error("attendance reminder failed", { tenantId: workspace.id, error });
      }
    }
  }

  return result;
}

export type PurgeDeviceTokensResult = { deleted: number; cutoff: string };

/**
 * SYSTEM: token yang tidak diperbarui dalam N hari dianggap perangkat mati.
 * Dipanggil worker terjadwal; filter hanya pada updated_at, tanpa data pribadi.
 */
export async function purgeStaleDeviceTokens(
  input: {
    olderThanDays?: number;
    now?: Date;
    client?: ReturnType<typeof systemDb>;
  } = {},
): Promise<PurgeDeviceTokensResult> {
  const days = input.olderThanDays ?? 60;
  if (!Number.isInteger(days) || days < 1 || days > 3650) {
    throw new HttpError(400, "INVALID_TOKEN_TTL", "olderThanDays tidak valid");
  }
  const now = input.now ?? new Date();
  const cutoff = new Date(now.getTime() - days * 86_400_000);
  const client = input.client ?? systemDb();
  const deleted = await client.deviceToken.deleteMany({
    where: { updatedAt: { lt: cutoff } },
  });
  return { deleted: deleted.count, cutoff: cutoff.toISOString() };
}
