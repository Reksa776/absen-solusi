import { randomUUID } from "node:crypto";

import { isUuid, systemDb, withTenant, type TenantContext } from "@absensi/database";

import { getFirebaseMessaging } from "./firebase-admin.js";
import { HttpError } from "./http.js";
import { logger } from "./logger.js";

export const PUSH_PLATFORMS = ["android", "ios"] as const;
export type DevicePushPlatform = (typeof PUSH_PLATFORMS)[number];
export const PUSH_TOKEN_MIN_LENGTH = 10;
export const PUSH_TOKEN_MAX_LENGTH = 512;
export const APPROVAL_NOTIFICATION_CHANNEL = "approval_alerts_high";

export type PushNotificationMessage = {
  title: string;
  body: string;
  data?: Record<string, string> | undefined;
};

export type PushNotificationResult = {
  delivered: number;
  failed: number;
  pruned: number;
};

export type PushSendOutcome = {
  delivered: number;
  failed: number;
  invalidTokens: readonly string[];
};

export interface PushNotificationSender {
  send(
    tokens: readonly string[],
    message: PushNotificationMessage,
  ): Promise<PushSendOutcome>;
}

type MulticastResponse = {
  successCount: number;
  failureCount: number;
  responses: ReadonlyArray<{ success: boolean; error?: { code?: string } | undefined }>;
};

type MulticastMessaging = {
  sendEachForMulticast(message: Record<string, unknown>): Promise<MulticastResponse>;
};

const INVALID_TOKEN_CODES = new Set([
  "messaging/registration-token-not-registered",
  "messaging/invalid-registration-token",
  "messaging/invalid-argument",
]);

/**
 * Pengiriman multicast FCM dengan konfigurasi high-priority untuk Android dan
 * APNs. Token dipecah per 500 (batas FCM) dan token yang tidak terdaftar lagi
 * dikembalikan agar pemanggil dapat membersihkannya.
 */
export class FirebasePushNotificationSender implements PushNotificationSender {
  constructor(
    private readonly messaging: MulticastMessaging,
    private readonly maxTokensPerRequest = 500,
  ) {}

  async send(
    tokens: readonly string[],
    message: PushNotificationMessage,
  ): Promise<PushSendOutcome> {
    let delivered = 0;
    let failed = 0;
    const invalidTokens: string[] = [];
    for (let offset = 0; offset < tokens.length; offset += this.maxTokensPerRequest) {
      const chunk = tokens.slice(offset, offset + this.maxTokensPerRequest);
      const response = await this.messaging.sendEachForMulticast({
        tokens: chunk,
        notification: { title: message.title, body: message.body },
        ...(message.data ? { data: message.data } : {}),
        android: {
          priority: "high",
          notification: {
            channelId: APPROVAL_NOTIFICATION_CHANNEL,
            sound: "default",
          },
        },
        apns: {
          headers: { "apns-priority": "10" },
          payload: {
            aps: { sound: "default", badge: 1, "content-available": 1 },
          },
        },
      });
      delivered += response.successCount;
      failed += response.failureCount;
      response.responses.forEach((item, index) => {
        if (item.success) return;
        const code = item.error?.code ?? "";
        if (!INVALID_TOKEN_CODES.has(code)) return;
        const token = chunk[index];
        if (token) invalidTokens.push(token);
      });
    }
    return { delivered, failed, invalidTokens };
  }
}

class UnconfiguredPushNotificationSender implements PushNotificationSender {
  async send(): Promise<PushSendOutcome> {
    return { delivered: 0, failed: 0, invalidTokens: [] };
  }
}

const UNCONFIGURED_SENDER = new UnconfiguredPushNotificationSender();
let senderOverride: PushNotificationSender | null = null;

/** Test mengganti pengirim agar tidak memanggil FCM sungguhan. */
export function setPushNotificationSender(sender: PushNotificationSender | null): void {
  senderOverride = sender;
}

function resolveSender(): PushNotificationSender {
  if (senderOverride) return senderOverride;
  const messaging = getFirebaseMessaging();
  return messaging
    ? new FirebasePushNotificationSender(messaging as unknown as MulticastMessaging)
    : UNCONFIGURED_SENDER;
}

function normalizePlatform(value: string): DevicePushPlatform {
  const platform = value.trim().toLowerCase();
  if ((PUSH_PLATFORMS as readonly string[]).includes(platform)) {
    return platform as DevicePushPlatform;
  }
  throw new HttpError(400, "INVALID_PLATFORM", "Platform harus android atau ios");
}

function normalizeToken(value: string): string {
  const token = value.trim();
  if (token.length < PUSH_TOKEN_MIN_LENGTH || token.length > PUSH_TOKEN_MAX_LENGTH) {
    throw new HttpError(
      400,
      "INVALID_DEVICE_TOKEN",
      `Token perangkat harus ${PUSH_TOKEN_MIN_LENGTH}-${PUSH_TOKEN_MAX_LENGTH} karakter`,
    );
  }
  return token;
}

export type RegisterPushTokenInput = {
  ctx: TenantContext;
  token: string;
  platform: string;
};

export type RegisteredPushToken = {
  id: string;
  platform: DevicePushPlatform;
};

/**
 * Token FCM bersifat global per user (bukan per tenant): satu perangkat tidak
 * boleh menerima notifikasi dua akun. Pendaftaran ulang memindahkan pemilik.
 */
export async function registerPushToken(
  input: RegisterPushTokenInput,
): Promise<RegisteredPushToken> {
  const token = normalizeToken(input.token);
  const platform = normalizePlatform(input.platform);
  const row = await systemDb().devicePushToken.upsert({
    where: { token },
    create: {
      id: randomUUID(),
      userId: input.ctx.userId,
      token,
      platform,
    },
    update: { userId: input.ctx.userId, platform },
  });
  return { id: row.id, platform };
}

export type DeletePushTokenInput = {
  ctx: TenantContext;
  token?: string | undefined;
};

/**
 * Logout menghapus token perangkat agar perangkat lama tidak lagi menerima
 * notifikasi akun yang sudah keluar. Tanpa token, seluruh token user dihapus.
 */
export async function deletePushToken(
  input: DeletePushTokenInput,
): Promise<{ deleted: number }> {
  const token = input.token?.trim() ?? "";
  const result = await systemDb().devicePushToken.deleteMany({
    where: token
      ? { userId: input.ctx.userId, token }
      : { userId: input.ctx.userId },
  });
  return { deleted: result.count };
}

/**
 * Mengirim notifikasi ke semua perangkat aktif milik satu user dan
 * membersihkan token yang sudah tidak terdaftar. Kegagalan FCM tidak pernah
 * melempar error ke alur approval.
 */
export async function sendPushNotificationToUser(
  userId: string,
  message: PushNotificationMessage,
): Promise<PushNotificationResult> {
  if (!isUuid(userId)) return { delivered: 0, failed: 0, pruned: 0 };
  let tokens: string[] = [];
  try {
    const db = systemDb();
    const rows = await db.devicePushToken.findMany({
      where: { userId },
      select: { token: true },
    });
    tokens = rows.map((row) => row.token);
    if (tokens.length === 0) return { delivered: 0, failed: 0, pruned: 0 };
    const outcome = await resolveSender().send(tokens, message);
    let pruned = 0;
    if (outcome.invalidTokens.length > 0) {
      const deleted = await db.devicePushToken.deleteMany({
        where: { token: { in: [...outcome.invalidTokens] } },
      });
      pruned = deleted.count;
    }
    if (outcome.delivered > 0) {
      logger.info("approval push sent", {
        delivered: outcome.delivered,
        failed: outcome.failed,
        pruned,
      });
    }
    return { delivered: outcome.delivered, failed: outcome.failed, pruned };
  } catch (error) {
    logger.error("approval push failed", { error });
    return { delivered: 0, failed: tokens.length, pruned: 0 };
  }
}

export type SendApprovalPushInput = {
  ctx: TenantContext;
  memberId: string;
  message: PushNotificationMessage;
};

/** Notifikasi approval selalu best-effort: keputusan review sudah commit. */
export async function sendPushNotificationToMember(
  input: SendApprovalPushInput,
): Promise<PushNotificationResult> {
  try {
    const member = await withTenant(input.ctx, (db) =>
      db.workspaceMember.findFirst({
        where: { id: input.memberId },
        select: { userId: true },
      }),
    );
    if (!member) return { delivered: 0, failed: 0, pruned: 0 };
    return await sendPushNotificationToUser(member.userId, input.message);
  } catch (error) {
    logger.error("approval push to member failed", {
      memberId: input.memberId,
      error,
    });
    return { delivered: 0, failed: 0, pruned: 0 };
  }
}
