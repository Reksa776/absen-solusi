import { randomUUID } from "node:crypto";

import { withTenant, writeAudit, type TenantContext } from "@absensi/database";

import { HttpError } from "./http.js";
import { assertWorkspaceReadClaim } from "./workspaces.js";

export const GPS_RADIUS_POLICIES = ["STRICT", "FLAG", "OFF"] as const;
export type GpsRadiusPolicy = (typeof GPS_RADIUS_POLICIES)[number];

export type AttendanceSettingSummary = {
  id: string | null;
  defaultLateToleranceMinutes: number;
  earliestCheckInMinutes: number;
  maxCheckOutMinutes: number;
  requireSelfie: boolean;
  gpsRadiusPolicy: GpsRadiusPolicy;
  updatedAt: string | null;
};

const DEFAULTS: AttendanceSettingSummary = {
  id: null,
  defaultLateToleranceMinutes: 15,
  earliestCheckInMinutes: 120,
  maxCheckOutMinutes: 240,
  requireSelfie: true,
  gpsRadiusPolicy: "STRICT",
  updatedAt: null,
};

function assertRead(ctx: TenantContext): void {
  if (!ctx.permissions.includes("attendance.read") && !ctx.permissions.includes("member.manage")) {
    throw new HttpError(403, "FORBIDDEN", "Permission tidak mencukupi");
  }
}

function assertManage(ctx: TenantContext): void {
  if (!ctx.permissions.includes("member.manage")) {
    throw new HttpError(403, "FORBIDDEN", "Permission tidak mencukupi");
  }
}

function boundedInt(value: unknown, field: string, min: number, max: number): number {
  const number = Number(value);
  if (!Number.isInteger(number) || number < min || number > max) {
    throw new HttpError(400, "INVALID_NUMBER", `${field} harus ${min}-${max}`);
  }
  return number;
}

function policy(value: unknown, fallback: GpsRadiusPolicy): GpsRadiusPolicy {
  if (value === undefined) return fallback;
  const normalized = typeof value === "string" ? value.trim().toUpperCase() : "";
  if (!(GPS_RADIUS_POLICIES as readonly string[]).includes(normalized)) {
    throw new HttpError(400, "INVALID_RADIUS_POLICY", "Kebijakan radius GPS tidak valid");
  }
  return normalized as GpsRadiusPolicy;
}

function toSummary(row: {
  id: string;
  defaultLateToleranceMinutes: number;
  earliestCheckInMinutes: number;
  maxCheckOutMinutes: number;
  requireSelfie: boolean;
  gpsRadiusPolicy: string;
  updatedAt: Date;
}): AttendanceSettingSummary {
  return {
    id: row.id,
    defaultLateToleranceMinutes: row.defaultLateToleranceMinutes,
    earliestCheckInMinutes: row.earliestCheckInMinutes,
    maxCheckOutMinutes: row.maxCheckOutMinutes,
    requireSelfie: row.requireSelfie,
    gpsRadiusPolicy: (GPS_RADIUS_POLICIES as readonly string[]).includes(row.gpsRadiusPolicy)
      ? (row.gpsRadiusPolicy as GpsRadiusPolicy)
      : "STRICT",
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function getAttendanceSetting(input: {
  ctx: TenantContext;
  workspaceId: string;
}): Promise<AttendanceSettingSummary> {
  assertRead(input.ctx);
  assertWorkspaceReadClaim(input.ctx, input.workspaceId);
  const row = await withTenant(input.ctx, (db) => db.attendanceSetting.findFirst());
  return row ? toSummary(row) : DEFAULTS;
}

export async function updateAttendanceSetting(input: {
  ctx: TenantContext;
  workspaceId: string;
  body: Record<string, unknown>;
  ip?: string | null;
  userAgent?: string | null;
}): Promise<AttendanceSettingSummary> {
  assertManage(input.ctx);
  assertWorkspaceReadClaim(input.ctx, input.workspaceId);
  const current = await withTenant(input.ctx, (db) => db.attendanceSetting.findFirst());
  const fallback = current ? toSummary(current) : DEFAULTS;
  const values = {
    defaultLateToleranceMinutes: boundedInt(
      input.body.defaultLateToleranceMinutes ?? fallback.defaultLateToleranceMinutes,
      "Toleransi keterlambatan",
      0,
      180,
    ),
    earliestCheckInMinutes: boundedInt(
      input.body.earliestCheckInMinutes ?? fallback.earliestCheckInMinutes,
      "Batas awal check-in",
      0,
      720,
    ),
    maxCheckOutMinutes: boundedInt(
      input.body.maxCheckOutMinutes ?? fallback.maxCheckOutMinutes,
      "Batas check-out",
      0,
      1440,
    ),
    requireSelfie:
      input.body.requireSelfie === undefined
        ? fallback.requireSelfie
        : Boolean(input.body.requireSelfie),
    gpsRadiusPolicy: policy(input.body.gpsRadiusPolicy, fallback.gpsRadiusPolicy),
  };

  const row = await withTenant(input.ctx, (db) =>
    db.$transaction(async (tx) => {
      const saved = current
        ? await tx.attendanceSetting.update({
            where: { tenantId_id: { tenantId: input.ctx.tenantId, id: current.id } },
            data: values,
          })
        : await tx.attendanceSetting.create({
            data: { id: randomUUID(), tenantId: input.ctx.tenantId, ...values },
          });
      await writeAudit(
        {
          tenantId: input.ctx.tenantId,
          actorType: "USER",
          actorUserId: input.ctx.userId,
          actorMemberId: input.ctx.memberId,
          action: "attendance.setting_update",
          resourceType: "attendance_setting",
          resourceId: saved.id,
          metadata: values,
          ip: input.ip ?? null,
          userAgent: input.userAgent ?? null,
        },
        tx,
      );
      return saved;
    }),
  );
  return toSummary(row);
}
