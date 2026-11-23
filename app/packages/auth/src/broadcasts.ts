import { randomUUID } from "node:crypto";

import { isUuid, withTenant, writeAudit, type TenantContext } from "@absensi/database";

import { HttpError } from "./http.js";
import { assertWorkspaceReadClaim } from "./workspaces.js";

export const BROADCAST_AUDIENCES = ["ALL", "DIVISION", "LOCATION"] as const;
export const BROADCAST_PRIORITIES = ["NORMAL", "PENTING"] as const;
export type BroadcastAudience = (typeof BROADCAST_AUDIENCES)[number];
export type BroadcastPriority = (typeof BROADCAST_PRIORITIES)[number];

export type BroadcastSummary = {
  id: string;
  title: string;
  content: string;
  audienceType: BroadcastAudience;
  divisionId: string | null;
  divisionName: string | null;
  locationId: string | null;
  locationName: string | null;
  priority: BroadcastPriority;
  publishedAt: string | null;
  createdByName: string;
  createdAt: string;
};

function assertManage(ctx: TenantContext): void {
  if (!ctx.permissions.includes("member.manage")) {
    throw new HttpError(403, "FORBIDDEN", "Permission tidak mencukupi");
  }
}

function assertRead(ctx: TenantContext): void {
  if (
    !ctx.permissions.includes("member.read") &&
    !ctx.permissions.includes("member.manage") &&
    !ctx.roleKeys.includes("WORKSPACE_OWNER") &&
    !ctx.roleKeys.includes("WORKSPACE_ADMIN")
  ) {
    throw new HttpError(403, "FORBIDDEN", "Permission tidak mencukupi");
  }
}

function parseAudience(value: unknown): BroadcastAudience {
  const audience =
    typeof value === "string" ? value.trim().toUpperCase() : "ALL";
  if (!(BROADCAST_AUDIENCES as readonly string[]).includes(audience)) {
    throw new HttpError(400, "INVALID_AUDIENCE", "Target broadcast tidak valid");
  }
  return audience as BroadcastAudience;
}

function parsePriority(value: unknown): BroadcastPriority {
  const priority =
    typeof value === "string" ? value.trim().toUpperCase() : "NORMAL";
  if (!(BROADCAST_PRIORITIES as readonly string[]).includes(priority)) {
    throw new HttpError(400, "INVALID_PRIORITY", "Prioritas broadcast tidak valid");
  }
  return priority as BroadcastPriority;
}

function toSummary(row: {
  id: string;
  title: string;
  content: string;
  audienceType: string;
  divisionId: string | null;
  locationId: string | null;
  priority: string;
  publishedAt: Date | null;
  createdAt: Date;
  division: { name: string } | null;
  location: { name: string } | null;
  creator: { user: { name: string } };
}): BroadcastSummary {
  return {
    id: row.id,
    title: row.title,
    content: row.content,
    audienceType: row.audienceType as BroadcastAudience,
    divisionId: row.divisionId,
    divisionName: row.division?.name ?? null,
    locationId: row.locationId,
    locationName: row.location?.name ?? null,
    priority: row.priority as BroadcastPriority,
    publishedAt: row.publishedAt ? row.publishedAt.toISOString() : null,
    createdByName: row.creator.user.name,
    createdAt: row.createdAt.toISOString(),
  };
}

const INCLUDE = {
  division: { select: { name: true } },
  location: { select: { name: true } },
  creator: { include: { user: { select: { name: true } } } },
} as const;

export async function createBroadcast(input: {
  ctx: TenantContext;
  workspaceId: string;
  title: unknown;
  content: unknown;
  audienceType: unknown;
  divisionId: unknown;
  locationId: unknown;
  priority: unknown;
  publishNow?: boolean;
  ip?: string | null;
  userAgent?: string | null;
  now?: Date;
}): Promise<BroadcastSummary> {
  assertManage(input.ctx);
  assertWorkspaceReadClaim(input.ctx, input.workspaceId);
  const title = typeof input.title === "string" ? input.title.trim() : "";
  if (title.length < 3 || title.length > 160) {
    throw new HttpError(400, "INVALID_TITLE", "Judul broadcast 3–160 karakter");
  }
  const content = typeof input.content === "string" ? input.content.trim() : "";
  if (content.length < 5 || content.length > 2000) {
    throw new HttpError(400, "INVALID_CONTENT", "Isi broadcast 5–2000 karakter");
  }
  const audienceType = parseAudience(input.audienceType);
  const priority = parsePriority(input.priority);
  const divisionId = typeof input.divisionId === "string" ? input.divisionId : null;
  const locationId = typeof input.locationId === "string" ? input.locationId : null;
  if (audienceType === "DIVISION" && (!divisionId || !isUuid(divisionId))) {
    throw new HttpError(400, "INVALID_AUDIENCE", "Divisi target wajib dipilih");
  }
  if (audienceType === "LOCATION" && (!locationId || !isUuid(locationId))) {
    throw new HttpError(400, "INVALID_AUDIENCE", "Lokasi target wajib dipilih");
  }
  const now = input.now ?? new Date();
  const id = randomUUID();

  const created = await withTenant(input.ctx, (db) =>
    db.$transaction(async (tx) => {
      if (audienceType === "DIVISION") {
        const division = await tx.division.findFirst({
          where: { id: divisionId as string, isActive: true },
          select: { id: true },
        });
        if (!division) throw new HttpError(404, "DIVISION_NOT_FOUND", "Divisi tidak ditemukan");
      }
      if (audienceType === "LOCATION") {
        const location = await tx.officeLocation.findFirst({
          where: { id: locationId as string, isActive: true },
          select: { id: true },
        });
        if (!location) throw new HttpError(404, "LOCATION_NOT_FOUND", "Lokasi tidak ditemukan");
      }
      const row = await tx.broadcastMessage.create({
        data: {
          id,
          tenantId: input.ctx.tenantId,
          title,
          content,
          audienceType,
          divisionId: audienceType === "DIVISION" ? divisionId : null,
          locationId: audienceType === "LOCATION" ? locationId : null,
          priority,
          publishedAt: input.publishNow ? now : null,
          createdByMemberId: input.ctx.memberId,
        },
        include: INCLUDE,
      });
      await writeAudit(
        {
          tenantId: input.ctx.tenantId,
          actorType: "USER",
          actorUserId: input.ctx.userId,
          actorMemberId: input.ctx.memberId,
          action: input.publishNow ? "broadcast.publish" : "broadcast.create",
          resourceType: "broadcast",
          resourceId: id,
          metadata: {
            audienceType,
            divisionId: row.divisionId,
            locationId: row.locationId,
            priority,
            published: Boolean(row.publishedAt),
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

export async function publishBroadcast(input: {
  ctx: TenantContext;
  workspaceId: string;
  broadcastId: string;
  ip?: string | null;
  userAgent?: string | null;
  now?: Date;
}): Promise<BroadcastSummary> {
  assertManage(input.ctx);
  assertWorkspaceReadClaim(input.ctx, input.workspaceId);
  if (!isUuid(input.broadcastId)) {
    throw new HttpError(400, "INVALID_BROADCAST", "Broadcast tidak valid");
  }
  const now = input.now ?? new Date();
  const updated = await withTenant(input.ctx, (db) =>
    db.$transaction(async (tx) => {
      const existing = await tx.broadcastMessage.findFirst({
        where: { id: input.broadcastId },
        include: INCLUDE,
      });
      if (!existing) {
        throw new HttpError(404, "BROADCAST_NOT_FOUND", "Broadcast tidak ditemukan");
      }
      if (existing.publishedAt) return existing;
      const row = await tx.broadcastMessage.update({
        where: { tenantId_id: { tenantId: input.ctx.tenantId, id: existing.id } },
        data: { publishedAt: now },
        include: INCLUDE,
      });
      await writeAudit(
        {
          tenantId: input.ctx.tenantId,
          actorType: "USER",
          actorUserId: input.ctx.userId,
          actorMemberId: input.ctx.memberId,
          action: "broadcast.publish",
          resourceType: "broadcast",
          resourceId: row.id,
          metadata: { audienceType: row.audienceType, priority: row.priority },
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

export async function listWorkspaceBroadcasts(input: {
  ctx: TenantContext;
  workspaceId: string;
}): Promise<BroadcastSummary[]> {
  assertRead(input.ctx);
  assertWorkspaceReadClaim(input.ctx, input.workspaceId);
  const rows = await withTenant(input.ctx, (db) =>
    db.broadcastMessage.findMany({
      include: INCLUDE,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 200,
    }),
  );
  return rows.map(toSummary);
}

export async function listMyBroadcasts(input: {
  ctx: TenantContext;
}): Promise<BroadcastSummary[]> {
  const rows = await withTenant(input.ctx, async (db) => {
    const member = await db.workspaceMember.findFirst({
      where: { id: input.ctx.memberId },
      select: { divisionId: true, officeLocationId: true },
    });
    if (!member) return [];
    const audienceFilters: Array<Record<string, string>> = [{ audienceType: "ALL" }];
    if (member.divisionId) {
      audienceFilters.push({ audienceType: "DIVISION", divisionId: member.divisionId });
    }
    if (member.officeLocationId) {
      audienceFilters.push({ audienceType: "LOCATION", locationId: member.officeLocationId });
    }
    return db.broadcastMessage.findMany({
      where: {
        publishedAt: { not: null },
        OR: audienceFilters,
      },
      include: INCLUDE,
      orderBy: [{ priority: "desc" }, { publishedAt: "desc" }, { id: "desc" }],
      take: 100,
    });
  });
  return rows.map(toSummary);
}
