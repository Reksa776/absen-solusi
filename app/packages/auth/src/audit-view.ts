import { withTenant, type TenantContext } from "@absensi/database";

import { HttpError } from "./http.js";
import { assertWorkspaceReadClaim } from "./workspaces.js";

export const AUDIT_VIEW_DEFAULT_LIMIT = 50;
export const AUDIT_VIEW_MAX_LIMIT = 100;

export type ListAuditLogsInput = {
  ctx: TenantContext;
  workspaceId: string;
  action?: string | undefined;
  resourceId?: string | undefined;
  limit?: number | undefined;
  offset?: number | undefined;
};

export type AuditLogSummary = {
  id: string;
  action: string;
  actorType: string;
  actorUserId: string | null;
  actorMemberId: string | null;
  resourceType: string;
  resourceId: string | null;
  metadata: unknown;
  createdAt: string;
};

export type ListAuditLogsResult = {
  logs: AuditLogSummary[];
  pagination: { limit: number; offset: number; total: number };
};

function pageValue(value: number | undefined, fallback: number, min: number, max: number): number {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new HttpError(400, "INVALID_PAGINATION", "Parameter pagination tidak valid");
  }
  return value;
}

/** Audit viewer read-only; tenant selalu dari ctx, bukan dari :id. */
export async function listAuditLogs(input: ListAuditLogsInput): Promise<ListAuditLogsResult> {
  assertWorkspaceReadClaim(input.ctx, input.workspaceId);
  const limit = pageValue(input.limit, AUDIT_VIEW_DEFAULT_LIMIT, 1, AUDIT_VIEW_MAX_LIMIT);
  const offset = pageValue(input.offset, 0, 0, Number.MAX_SAFE_INTEGER);
  const action = input.action?.trim();
  if (action && (action.length > 64 || !/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/.test(action))) {
    throw new HttpError(400, "INVALID_ACTION", "Filter action tidak valid");
  }
  const resourceId = input.resourceId?.trim();
  if (resourceId && resourceId.length > 64) {
    throw new HttpError(400, "INVALID_RESOURCE", "Filter resource tidak valid");
  }

  return withTenant(input.ctx, async (db) => {
    const where = {
      ...(action ? { action } : {}),
      ...(resourceId ? { resourceId } : {}),
    };
    const total = await db.auditLog.count({ where });
    const rows = await db.auditLog.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit,
      skip: offset,
    });
    return {
      logs: rows.map((row) => ({
        id: row.id,
        action: row.action,
        actorType: row.actorType,
        actorUserId: row.actorUserId,
        actorMemberId: row.actorMemberId,
        resourceType: row.resourceType,
        resourceId: row.resourceId,
        metadata: row.metadata,
        createdAt: row.createdAt.toISOString(),
      })),
      pagination: { limit, offset, total },
    };
  });
}
