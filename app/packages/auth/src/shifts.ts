import { randomUUID } from "node:crypto";

import { isUuid, withTenant, writeAudit, type TenantContext } from "@absensi/database";

import { HttpError } from "./http.js";
import { parseReportDay } from "./reports.js";
import { assertWorkspaceReadClaim } from "./workspaces.js";

export const SHIFT_NAME_MAX_LENGTH = 120;
export const SHIFT_TOLERANCE_MAX_MINUTES = 120;
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

export type ShiftSummary = {
  id: string;
  name: string;
  startTime: string;
  endTime: string;
  lateToleranceMinutes: number;
  isOvernight: boolean;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

export type ShiftAssignmentSummary = {
  id: string;
  memberId: string;
  memberName: string;
  shiftId: string;
  shiftName: string;
  workDate: string | null;
  createdAt: string;
};

function assertManage(ctx: TenantContext): void {
  if (!ctx.permissions.includes("office.manage")) {
    throw new HttpError(403, "FORBIDDEN", "Permission tidak mencukupi");
  }
}

function minutes(value: string): number {
  return Number(value.slice(0, 2)) * 60 + Number(value.slice(3, 5));
}

function parseTime(value: unknown, field: string): string {
  if (typeof value !== "string" || !TIME_PATTERN.test(value.trim())) {
    throw new HttpError(400, "INVALID_TIME", `Field ${field} harus berformat HH:MM`);
  }
  return value.trim();
}

function validateHours(startTime: string, endTime: string): void {
  if (minutes(endTime) === minutes(startTime)) {
    throw new HttpError(
      400,
      "INVALID_SHIFT_HOURS",
      "Jam pulang shift tidak boleh sama dengan jam masuk",
    );
  }
}

export function shiftMinutes(value: string): number {
  return minutes(value);
}

/** Shift malam: pulang pada hari kalender berikutnya. */
export function isOvernightShift(startTime: string, endTime: string): boolean {
  return minutes(endTime) < minutes(startTime);
}

function zonedMinutesOfDay(date: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(date);
  const hour = Number(parts.find((part) => part.type === "hour")?.value ?? "0");
  const minute = Number(parts.find((part) => part.type === "minute")?.value ?? "0");
  return (hour % 24) * 60 + minute;
}

/** Keterlambatan shift, termasuk check-in setelah tengah malam pada shift overnight. */
export function lateMinutesForShift(
  checkIn: Date,
  rule: { startTime: string; endTime: string; lateToleranceMinutes: number },
  timeZone: string,
): number {
  const start = minutes(rule.startTime);
  const end = minutes(rule.endTime);
  let actual = zonedMinutesOfDay(checkIn, timeZone);
  if (isOvernightShift(rule.startTime, rule.endTime) && actual < end) {
    actual += 24 * 60;
  }
  return Math.max(0, actual - start - rule.lateToleranceMinutes);
}

function parseTolerance(value: unknown, fallback = 15): number {
  if (value === undefined) return fallback;
  const parsed = typeof value === "number" ? value : Number(value);
  if (
    !Number.isInteger(parsed) ||
    parsed < 0 ||
    parsed > SHIFT_TOLERANCE_MAX_MINUTES
  ) {
    throw new HttpError(
      400,
      "INVALID_TOLERANCE",
      `Toleransi shift harus 0-${SHIFT_TOLERANCE_MAX_MINUTES} menit`,
    );
  }
  return parsed;
}

function parseName(value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new HttpError(400, "INVALID_NAME", "Nama shift wajib diisi");
  }
  const name = value.trim();
  if (name.length > SHIFT_NAME_MAX_LENGTH) {
    throw new HttpError(400, "INVALID_NAME", "Nama shift terlalu panjang");
  }
  return name;
}

function toSummary(row: {
  id: string;
  name: string;
  startTime: string;
  endTime: string;
  lateToleranceMinutes: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}): ShiftSummary {
  return {
    id: row.id,
    name: row.name,
    startTime: row.startTime,
    endTime: row.endTime,
    lateToleranceMinutes: row.lateToleranceMinutes,
    isOvernight: isOvernightShift(row.startTime, row.endTime),
    isActive: row.isActive,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function listShifts(input: {
  ctx: TenantContext;
  workspaceId: string;
}): Promise<ShiftSummary[]> {
  assertWorkspaceReadClaim(input.ctx, input.workspaceId);
  const rows = await withTenant(input.ctx, (db) =>
    db.workShift.findMany({
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    }),
  );
  return rows.map(toSummary);
}

export async function createShift(input: {
  ctx: TenantContext;
  workspaceId: string;
  body: Record<string, unknown>;
  ip?: string | null;
  userAgent?: string | null;
}): Promise<ShiftSummary> {
  assertManage(input.ctx);
  assertWorkspaceReadClaim(input.ctx, input.workspaceId);
  const name = parseName(input.body.name);
  const startTime = parseTime(input.body.startTime, "startTime");
  const endTime = parseTime(input.body.endTime, "endTime");
  validateHours(startTime, endTime);
  const lateToleranceMinutes = parseTolerance(input.body.lateToleranceMinutes);
  const isActive = input.body.isActive === undefined ? true : input.body.isActive === true;
  const id = randomUUID();

  const created = await withTenant(input.ctx, (db) =>
    db.$transaction(async (tx) => {
      const row = await tx.workShift.create({
        data: {
          id,
          tenantId: input.ctx.tenantId,
          name,
          startTime,
          endTime,
          lateToleranceMinutes,
          isActive,
        },
      });
      await writeAudit(
        {
          tenantId: input.ctx.tenantId,
          actorType: "USER",
          actorUserId: input.ctx.userId,
          actorMemberId: input.ctx.memberId,
          action: "shift.create",
          resourceType: "work_shift",
          resourceId: id,
          metadata: { name, startTime, endTime, lateToleranceMinutes },
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

export async function updateShift(input: {
  ctx: TenantContext;
  workspaceId: string;
  shiftId: string;
  body: Record<string, unknown>;
  ip?: string | null;
  userAgent?: string | null;
}): Promise<ShiftSummary> {
  assertManage(input.ctx);
  assertWorkspaceReadClaim(input.ctx, input.workspaceId);
  if (!isUuid(input.shiftId)) {
    throw new HttpError(400, "INVALID_SHIFT", "Shift tidak valid");
  }
  const existing = await withTenant(input.ctx, (db) =>
    db.workShift.findFirst({ where: { id: input.shiftId } }),
  );
  if (!existing) throw new HttpError(404, "SHIFT_NOT_FOUND", "Shift tidak ditemukan");

  const name = input.body.name === undefined ? existing.name : parseName(input.body.name);
  const startTime =
    input.body.startTime === undefined
      ? existing.startTime
      : parseTime(input.body.startTime, "startTime");
  const endTime =
    input.body.endTime === undefined
      ? existing.endTime
      : parseTime(input.body.endTime, "endTime");
  validateHours(startTime, endTime);
  const lateToleranceMinutes =
    input.body.lateToleranceMinutes === undefined
      ? existing.lateToleranceMinutes
      : parseTolerance(input.body.lateToleranceMinutes, existing.lateToleranceMinutes);
  const isActive =
    input.body.isActive === undefined ? existing.isActive : input.body.isActive === true;

  const updated = await withTenant(input.ctx, (db) =>
    db.$transaction(async (tx) => {
      const row = await tx.workShift.update({
        where: { tenantId_id: { tenantId: input.ctx.tenantId, id: existing.id } },
        data: { name, startTime, endTime, lateToleranceMinutes, isActive },
      });
      await writeAudit(
        {
          tenantId: input.ctx.tenantId,
          actorType: "USER",
          actorUserId: input.ctx.userId,
          actorMemberId: input.ctx.memberId,
          action: "shift.update",
          resourceType: "work_shift",
          resourceId: existing.id,
          metadata: { name, startTime, endTime, lateToleranceMinutes, isActive },
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

export async function deactivateShift(input: {
  ctx: TenantContext;
  workspaceId: string;
  shiftId: string;
  ip?: string | null;
  userAgent?: string | null;
}): Promise<ShiftSummary> {
  assertManage(input.ctx);
  assertWorkspaceReadClaim(input.ctx, input.workspaceId);
  const existing = await withTenant(input.ctx, (db) =>
    db.workShift.findFirst({ where: { id: input.shiftId } }),
  );
  if (!existing) throw new HttpError(404, "SHIFT_NOT_FOUND", "Shift tidak ditemukan");
  const updated = await withTenant(input.ctx, (db) =>
    db.$transaction(async (tx) => {
      const row = await tx.workShift.update({
        where: { tenantId_id: { tenantId: input.ctx.tenantId, id: existing.id } },
        data: { isActive: false },
      });
      await writeAudit(
        {
          tenantId: input.ctx.tenantId,
          actorType: "USER",
          actorUserId: input.ctx.userId,
          actorMemberId: input.ctx.memberId,
          action: "shift.deactivate",
          resourceType: "work_shift",
          resourceId: existing.id,
          metadata: { name: existing.name },
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

export async function assignShift(input: {
  ctx: TenantContext;
  workspaceId: string;
  memberId: string;
  shiftId: string;
  workDate?: string | null;
  ip?: string | null;
  userAgent?: string | null;
}): Promise<ShiftAssignmentSummary> {
  assertManage(input.ctx);
  assertWorkspaceReadClaim(input.ctx, input.workspaceId);
  if (!isUuid(input.memberId)) throw new HttpError(400, "INVALID_MEMBER", "Member tidak valid");
  if (!isUuid(input.shiftId)) throw new HttpError(400, "INVALID_SHIFT", "Shift tidak valid");
  const workDate = input.workDate ? parseReportDay(input.workDate, "workDate") : null;

  const result = await withTenant(input.ctx, (db) =>
    db.$transaction(async (tx) => {
      const [member, shift] = await Promise.all([
        tx.workspaceMember.findFirst({
          where: { id: input.memberId, status: "ACTIVE" },
          include: { user: { select: { name: true } } },
        }),
        tx.workShift.findFirst({
          where: { id: input.shiftId, isActive: true },
        }),
      ]);
      if (!member) throw new HttpError(404, "MEMBER_NOT_FOUND", "Member tidak ditemukan");
      if (!shift) throw new HttpError(404, "SHIFT_NOT_FOUND", "Shift aktif tidak ditemukan");

      const existing = await tx.memberShift.findFirst({
        where: {
          memberId: member.id,
          workDate: workDate,
        },
      });
      const row = existing
        ? await tx.memberShift.update({
            where: { tenantId_id: { tenantId: input.ctx.tenantId, id: existing.id } },
            data: { shiftId: shift.id },
          })
        : await tx.memberShift.create({
            data: {
              id: randomUUID(),
              tenantId: input.ctx.tenantId,
              memberId: member.id,
              shiftId: shift.id,
              workDate,
            },
          });
      await writeAudit(
        {
          tenantId: input.ctx.tenantId,
          actorType: "USER",
          actorUserId: input.ctx.userId,
          actorMemberId: input.ctx.memberId,
          action: "shift.assign",
          resourceType: "member_shift",
          resourceId: row.id,
          metadata: {
            memberId: member.id,
            shiftId: shift.id,
            workDate: workDate ? workDate.toISOString().slice(0, 10) : null,
          },
          ip: input.ip ?? null,
          userAgent: input.userAgent ?? null,
        },
        tx,
      );
      return {
        id: row.id,
        memberId: member.id,
        memberName: member.user.name,
        shiftId: shift.id,
        shiftName: shift.name,
        workDate: workDate ? workDate.toISOString().slice(0, 10) : null,
        createdAt: row.createdAt.toISOString(),
      };
    }),
  );
  return result;
}

export async function listShiftAssignments(input: {
  ctx: TenantContext;
  workspaceId: string;
  date?: string | undefined;
}): Promise<ShiftAssignmentSummary[]> {
  assertWorkspaceReadClaim(input.ctx, input.workspaceId);
  const date = input.date ? parseReportDay(input.date, "date") : null;
  const rows = await withTenant(input.ctx, (db) =>
    db.memberShift.findMany({
      where: date ? { OR: [{ workDate: date }, { workDate: null }] } : {},
      include: {
        member: { include: { user: { select: { name: true } } } },
        shift: { select: { name: true } },
      },
      orderBy: [{ workDate: "asc" }, { createdAt: "asc" }],
    }),
  );
  return rows.map((row) => ({
    id: row.id,
    memberId: row.memberId,
    memberName: row.member.user.name,
    shiftId: row.shiftId,
    shiftName: row.shift.name,
    workDate: row.workDate ? row.workDate.toISOString().slice(0, 10) : null,
    createdAt: row.createdAt.toISOString(),
  }));
}

export type ShiftRule = {
  shiftId: string;
  name: string;
  startTime: string;
  endTime: string;
  lateToleranceMinutes: number;
};

export type ShiftRuleIndex = Map<
  string,
  { defaultRule?: ShiftRule; byDate: Map<string, ShiftRule> }
>;

export function createShiftRuleIndex(
  rows: Array<{
    memberId: string;
    workDate: Date | null;
    shift: {
      id: string;
      name: string;
      startTime: string;
      endTime: string;
      lateToleranceMinutes: number;
    };
  }>,
): ShiftRuleIndex {
  const index: ShiftRuleIndex = new Map();
  for (const row of rows) {
    const entry: { defaultRule?: ShiftRule; byDate: Map<string, ShiftRule> } =
      index.get(row.memberId) ?? { byDate: new Map<string, ShiftRule>() };
    const rule: ShiftRule = {
      shiftId: row.shift.id,
      name: row.shift.name,
      startTime: row.shift.startTime,
      endTime: row.shift.endTime,
      lateToleranceMinutes: row.shift.lateToleranceMinutes,
    };
    if (row.workDate) {
      entry.byDate.set(row.workDate.toISOString().slice(0, 10), rule);
    } else {
      entry.defaultRule = rule;
    }
    index.set(row.memberId, entry);
  }
  return index;
}

export function shiftRuleFor(
  index: ShiftRuleIndex,
  memberId: string,
  dateKey: string,
): ShiftRule | null {
  const entry = index.get(memberId);
  return entry?.byDate.get(dateKey) ?? entry?.defaultRule ?? null;
}
