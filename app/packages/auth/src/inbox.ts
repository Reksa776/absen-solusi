import { randomUUID } from "node:crypto";

import { isUuid, withTenant, type Prisma, type TenantContext } from "@absensi/database";

import { HttpError } from "./http.js";

export const INBOX_LIST_DEFAULT_LIMIT = 30;
export const INBOX_LIST_MAX_LIMIT = 100;

export type InAppNotificationSummary = {
  id: string;
  type: string;
  title: string;
  body: string;
  linkUrl: string | null;
  isRead: boolean;
  readAt: string | null;
  createdAt: string;
};

export type InboxResult = {
  notifications: InAppNotificationSummary[];
  unreadCount: number;
};

export type CreateInAppNotificationInput = {
  tenantId: string;
  memberId: string;
  type: string;
  title: string;
  body: string;
  linkUrl?: string | null;
  id?: string;
};

/**
 * Dipanggil di dalam transaksi approval agar notifikasi ikut rollback bila
 * keputusan review gagal. Tidak ada akses lintas tenant di helper ini.
 */
export async function createInAppNotification(
  tx: Prisma.TransactionClient,
  input: CreateInAppNotificationInput,
): Promise<InAppNotificationSummary> {
  const row = await tx.inAppNotification.create({
    data: {
      id: input.id ?? randomUUID(),
      tenantId: input.tenantId,
      memberId: input.memberId,
      type: input.type,
      title: input.title,
      body: input.body,
      linkUrl: input.linkUrl ?? null,
    },
  });
  return toSummary(row);
}

function toSummary(row: {
  id: string;
  type: string;
  title: string;
  body: string;
  linkUrl: string | null;
  isRead: boolean;
  readAt: Date | null;
  createdAt: Date;
}): InAppNotificationSummary {
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    body: row.body,
    linkUrl: row.linkUrl,
    isRead: row.isRead,
    readAt: row.readAt ? row.readAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function listMyNotifications(input: {
  ctx: TenantContext;
  limit?: number | undefined;
  unreadOnly?: boolean | undefined;
}): Promise<InboxResult> {
  const limit = input.limit ?? INBOX_LIST_DEFAULT_LIMIT;
  if (!Number.isInteger(limit) || limit < 1 || limit > INBOX_LIST_MAX_LIMIT) {
    throw new HttpError(400, "INVALID_PAGINATION", "Limit notifikasi tidak valid");
  }
  return withTenant(input.ctx, async (db) => {
    const where = {
      memberId: input.ctx.memberId,
      ...(input.unreadOnly ? { isRead: false } : {}),
    };
    const [rows, unreadCount] = await Promise.all([
      db.inAppNotification.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: limit,
      }),
      db.inAppNotification.count({
        where: { memberId: input.ctx.memberId, isRead: false },
      }),
    ]);
    return { notifications: rows.map(toSummary), unreadCount };
  });
}

export async function markNotificationRead(input: {
  ctx: TenantContext;
  notificationId: string;
  now?: Date;
}): Promise<InAppNotificationSummary> {
  if (!isUuid(input.notificationId)) {
    throw new HttpError(404, "NOTIFICATION_NOT_FOUND", "Notifikasi tidak ditemukan");
  }
  return withTenant(input.ctx, async (db) => {
    const row = await db.inAppNotification.findFirst({
      where: { id: input.notificationId, memberId: input.ctx.memberId },
    });
    if (!row) {
      throw new HttpError(404, "NOTIFICATION_NOT_FOUND", "Notifikasi tidak ditemukan");
    }
    const updated = await db.inAppNotification.update({
      where: {
        tenantId_id: { tenantId: input.ctx.tenantId, id: row.id },
      },
      data: { isRead: true, readAt: row.readAt ?? input.now ?? new Date() },
    });
    return toSummary(updated);
  });
}

export async function markAllNotificationsRead(input: {
  ctx: TenantContext;
  now?: Date;
}): Promise<{ updated: number; unreadCount: number }> {
  return withTenant(input.ctx, async (db) => {
    const result = await db.inAppNotification.updateMany({
      where: { memberId: input.ctx.memberId, isRead: false },
      data: { isRead: true, readAt: input.now ?? new Date() },
    });
    return { updated: result.count, unreadCount: 0 };
  });
}
