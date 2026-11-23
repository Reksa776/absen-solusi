import { randomUUID } from "node:crypto";

import { isUuid, withTenant, writeAudit, type TenantContext } from "@absensi/database";

import { HttpError } from "./http.js";
import { assertWorkspaceReadClaim } from "./workspaces.js";

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
const DAY_NAMES = [
  "Senin",
  "Selasa",
  "Rabu",
  "Kamis",
  "Jumat",
  "Sabtu",
  "Minggu",
] as const;

export type WorkPatternDaySummary = {
  id: string;
  dayOfWeek: number;
  dayName: string;
  isWorkday: boolean;
  startTime: string;
  endTime: string;
  earliestCheckInMinutes: number;
  lateToleranceMinutes: number;
};

export type WorkPatternSummary = {
  id: string;
  name: string;
  timezone: string;
  isActive: boolean;
  assignedCount: number;
  days: WorkPatternDaySummary[];
  createdAt: string;
  updatedAt: string;
};

export type WorkPatternAssignmentSummary = {
  id: string;
  memberId: string;
  memberName: string;
  memberEmail: string;
  divisionName: string | null;
  workPatternId: string;
  workPatternName: string;
  isActive: boolean;
  assignedAt: string;
};

type DayInput = Omit<WorkPatternDaySummary, "id" | "dayName">;

function assertRead(ctx: TenantContext): void {
  if (!ctx.permissions.includes("member.read") && !ctx.permissions.includes("member.manage")) {
    throw new HttpError(403, "FORBIDDEN", "Permission tidak mencukupi");
  }
}

function assertManage(ctx: TenantContext): void {
  if (!ctx.permissions.includes("member.manage")) {
    throw new HttpError(403, "FORBIDDEN", "Permission tidak mencukupi");
  }
}

function assertTime(value: unknown, field: string): string {
  if (typeof value !== "string" || !TIME_PATTERN.test(value.trim())) {
    throw new HttpError(400, "INVALID_TIME", `${field} harus berformat HH:MM`);
  }
  return value.trim();
}

function boundedInt(value: unknown, field: string, min: number, max: number): number {
  const number = Number(value);
  if (!Number.isInteger(number) || number < min || number > max) {
    throw new HttpError(400, "INVALID_NUMBER", `${field} harus ${min}-${max}`);
  }
  return number;
}

function assertTimezone(value: unknown): string {
  const timezone = typeof value === "string" && value.trim() ? value.trim() : "UTC";
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format(new Date());
  } catch {
    throw new HttpError(400, "INVALID_TIMEZONE", "Zona waktu tidak valid");
  }
  return timezone;
}

function defaultDays(): DayInput[] {
  return Array.from({ length: 7 }, (_, index) => {
    const dayOfWeek = index + 1;
    return {
      dayOfWeek,
      isWorkday: dayOfWeek <= 5,
      startTime: "09:00",
      endTime: "17:00",
      earliestCheckInMinutes: 120,
      lateToleranceMinutes: 15,
    };
  });
}

function parseDays(value: unknown): DayInput[] {
  if (value === undefined) return defaultDays();
  if (!Array.isArray(value) || value.length !== 7) {
    throw new HttpError(400, "INVALID_DAYS", "Pola kerja harus memuat tujuh hari");
  }
  const seen = new Set<number>();
  const days = value.map((raw) => {
    if (typeof raw !== "object" || raw === null) {
      throw new HttpError(400, "INVALID_DAYS", "Format hari pola kerja tidak valid");
    }
    const row = raw as Record<string, unknown>;
    const dayOfWeek = boundedInt(row.dayOfWeek, "Hari", 1, 7);
    if (seen.has(dayOfWeek)) {
      throw new HttpError(400, "INVALID_DAYS", "Hari pola kerja tidak boleh duplikat");
    }
    seen.add(dayOfWeek);
    return {
      dayOfWeek,
      isWorkday: row.isWorkday === undefined ? true : Boolean(row.isWorkday),
      startTime: assertTime(row.startTime, "Jam masuk"),
      endTime: assertTime(row.endTime, "Jam pulang"),
      earliestCheckInMinutes: boundedInt(
        row.earliestCheckInMinutes ?? 120,
        "Batas awal check-in",
        0,
        720,
      ),
      lateToleranceMinutes: boundedInt(
        row.lateToleranceMinutes ?? 15,
        "Toleransi keterlambatan",
        0,
        180,
      ),
    };
  });
  if (seen.size !== 7) {
    throw new HttpError(400, "INVALID_DAYS", "Setiap hari Senin-Minggu wajib diisi");
  }
  return days.sort((left, right) => left.dayOfWeek - right.dayOfWeek);
}

function toDay(row: {
  id: string;
  dayOfWeek: number;
  isWorkday: boolean;
  startTime: string;
  endTime: string;
  earliestCheckInMinutes: number;
  lateToleranceMinutes: number;
}): WorkPatternDaySummary {
  return {
    id: row.id,
    dayOfWeek: row.dayOfWeek,
    dayName: DAY_NAMES[row.dayOfWeek - 1] ?? `Hari ${row.dayOfWeek}`,
    isWorkday: row.isWorkday,
    startTime: row.startTime,
    endTime: row.endTime,
    earliestCheckInMinutes: row.earliestCheckInMinutes,
    lateToleranceMinutes: row.lateToleranceMinutes,
  };
}

function toPattern(row: {
  id: string;
  name: string;
  timezone: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  days: Array<Parameters<typeof toDay>[0]>;
  _count?: { assignments: number };
}): WorkPatternSummary {
  return {
    id: row.id,
    name: row.name,
    timezone: row.timezone,
    isActive: row.isActive,
    assignedCount: row._count?.assignments ?? 0,
    days: row.days.map(toDay),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

const PATTERN_INCLUDE = {
  days: { orderBy: { dayOfWeek: "asc" as const } },
  _count: { select: { assignments: true } },
} as const;

export async function listWorkPatterns(input: {
  ctx: TenantContext;
  workspaceId: string;
}): Promise<WorkPatternSummary[]> {
  assertRead(input.ctx);
  assertWorkspaceReadClaim(input.ctx, input.workspaceId);
  const rows = await withTenant(input.ctx, (db) =>
    db.workPattern.findMany({ include: PATTERN_INCLUDE, orderBy: [{ isActive: "desc" }, { name: "asc" }] }),
  );
  return rows.map(toPattern);
}

export async function createWorkPattern(input: {
  ctx: TenantContext;
  workspaceId: string;
  body: Record<string, unknown>;
  ip?: string | null;
  userAgent?: string | null;
}): Promise<WorkPatternSummary> {
  assertManage(input.ctx);
  assertWorkspaceReadClaim(input.ctx, input.workspaceId);
  const name = typeof input.body.name === "string" ? input.body.name.trim() : "";
  if (name.length < 2 || name.length > 120) {
    throw new HttpError(400, "INVALID_NAME", "Nama pola kerja 2-120 karakter");
  }
  const timezone = assertTimezone(input.body.timezone);
  const days = parseDays(input.body.days);
  const id = randomUUID();

  const row = await withTenant(input.ctx, (db) =>
    db.$transaction(async (tx) => {
      const created = await tx.workPattern.create({
        data: {
          id,
          tenantId: input.ctx.tenantId,
          name,
          timezone,
          isActive: input.body.isActive === undefined ? true : Boolean(input.body.isActive),
        },
      });
      await tx.workPatternDay.createMany({
        data: days.map((day) => ({
          id: randomUUID(),
          tenantId: input.ctx.tenantId,
          workPatternId: created.id,
          ...day,
        })),
      });
      await writeAudit(
        {
          tenantId: input.ctx.tenantId,
          actorType: "USER",
          actorUserId: input.ctx.userId,
          actorMemberId: input.ctx.memberId,
          action: "work_pattern.create",
          resourceType: "work_pattern",
          resourceId: created.id,
          metadata: { name, workdays: days.filter((day) => day.isWorkday).length },
          ip: input.ip ?? null,
          userAgent: input.userAgent ?? null,
        },
        tx,
      );
      return tx.workPattern.findFirstOrThrow({ where: { id: created.id }, include: PATTERN_INCLUDE });
    }),
  );
  return toPattern(row);
}

export async function updateWorkPattern(input: {
  ctx: TenantContext;
  workspaceId: string;
  patternId: string;
  body: Record<string, unknown>;
  ip?: string | null;
  userAgent?: string | null;
}): Promise<WorkPatternSummary> {
  assertManage(input.ctx);
  assertWorkspaceReadClaim(input.ctx, input.workspaceId);
  if (!isUuid(input.patternId)) {
    throw new HttpError(404, "WORK_PATTERN_NOT_FOUND", "Pola kerja tidak ditemukan");
  }
  const existing = await withTenant(input.ctx, (db) =>
    db.workPattern.findFirst({ where: { id: input.patternId }, include: PATTERN_INCLUDE }),
  );
  if (!existing) {
    throw new HttpError(404, "WORK_PATTERN_NOT_FOUND", "Pola kerja tidak ditemukan");
  }
  const name =
    input.body.name === undefined
      ? existing.name
      : typeof input.body.name === "string"
        ? input.body.name.trim()
        : "";
  if (name.length < 2 || name.length > 120) {
    throw new HttpError(400, "INVALID_NAME", "Nama pola kerja 2-120 karakter");
  }
  const timezone =
    input.body.timezone === undefined ? existing.timezone : assertTimezone(input.body.timezone);
  const days = input.body.days === undefined ? null : parseDays(input.body.days);
  const isActive =
    input.body.isActive === undefined ? existing.isActive : Boolean(input.body.isActive);

  const row = await withTenant(input.ctx, (db) =>
    db.$transaction(async (tx) => {
      await tx.workPattern.update({
        where: { tenantId_id: { tenantId: input.ctx.tenantId, id: existing.id } },
        data: { name, timezone, isActive },
      });
      if (days) {
        await tx.workPatternDay.deleteMany({ where: { workPatternId: existing.id } });
        await tx.workPatternDay.createMany({
          data: days.map((day) => ({
            id: randomUUID(),
            tenantId: input.ctx.tenantId,
            workPatternId: existing.id,
            ...day,
          })),
        });
      }
      await writeAudit(
        {
          tenantId: input.ctx.tenantId,
          actorType: "USER",
          actorUserId: input.ctx.userId,
          actorMemberId: input.ctx.memberId,
          action: "work_pattern.update",
          resourceType: "work_pattern",
          resourceId: existing.id,
          metadata: { name, isActive, daysReplaced: Boolean(days) },
          ip: input.ip ?? null,
          userAgent: input.userAgent ?? null,
        },
        tx,
      );
      return tx.workPattern.findFirstOrThrow({
        where: { id: existing.id },
        include: PATTERN_INCLUDE,
      });
    }),
  );
  return toPattern(row);
}

export async function deactivateWorkPattern(input: {
  ctx: TenantContext;
  workspaceId: string;
  patternId: string;
  ip?: string | null;
  userAgent?: string | null;
}): Promise<WorkPatternSummary> {
  assertManage(input.ctx);
  assertWorkspaceReadClaim(input.ctx, input.workspaceId);
  if (!isUuid(input.patternId)) {
    throw new HttpError(404, "WORK_PATTERN_NOT_FOUND", "Pola kerja tidak ditemukan");
  }
  const existing = await withTenant(input.ctx, (db) =>
    db.workPattern.findFirst({
      where: { id: input.patternId },
      include: PATTERN_INCLUDE,
    }),
  );
  if (!existing) {
    throw new HttpError(404, "WORK_PATTERN_NOT_FOUND", "Pola kerja tidak ditemukan");
  }
  if (existing._count.assignments > 0) {
    throw new HttpError(
      409,
      "WORK_PATTERN_ASSIGNED",
      "Pola kerja masih dipakai karyawan. Pindahkan penugasan sebelum menonaktifkan.",
    );
  }
  const row = await withTenant(input.ctx, (db) =>
    db.$transaction(async (tx) => {
      const updated = await tx.workPattern.update({
        where: { tenantId_id: { tenantId: input.ctx.tenantId, id: existing.id } },
        data: { isActive: false },
        include: PATTERN_INCLUDE,
      });
      await writeAudit(
        {
          tenantId: input.ctx.tenantId,
          actorType: "USER",
          actorUserId: input.ctx.userId,
          actorMemberId: input.ctx.memberId,
          action: "work_pattern.deactivate",
          resourceType: "work_pattern",
          resourceId: existing.id,
          metadata: { name: existing.name },
          ip: input.ip ?? null,
          userAgent: input.userAgent ?? null,
        },
        tx,
      );
      return updated;
    }),
  );
  return toPattern(row);
}

const ASSIGNMENT_INCLUDE = {
  member: {
    include: {
      user: { select: { name: true, email: true } },
      division: { select: { name: true } },
    },
  },
  workPattern: { select: { id: true, name: true, isActive: true } },
} as const;

function toAssignment(row: {
  id: string;
  memberId: string;
  workPatternId: string;
  assignedAt: Date;
  member: { user: { name: string; email: string }; division: { name: string } | null };
  workPattern: { id: string; name: string; isActive: boolean };
}): WorkPatternAssignmentSummary {
  return {
    id: row.id,
    memberId: row.memberId,
    memberName: row.member.user.name,
    memberEmail: row.member.user.email,
    divisionName: row.member.division?.name ?? null,
    workPatternId: row.workPatternId,
    workPatternName: row.workPattern.name,
    isActive: row.workPattern.isActive,
    assignedAt: row.assignedAt.toISOString(),
  };
}

export async function listWorkPatternAssignments(input: {
  ctx: TenantContext;
  workspaceId: string;
}): Promise<WorkPatternAssignmentSummary[]> {
  assertRead(input.ctx);
  assertWorkspaceReadClaim(input.ctx, input.workspaceId);
  const rows = await withTenant(input.ctx, (db) =>
    db.workPatternAssignment.findMany({
      include: ASSIGNMENT_INCLUDE,
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
    }),
  );
  return rows.map(toAssignment);
}

export async function assignWorkPattern(input: {
  ctx: TenantContext;
  workspaceId: string;
  body: Record<string, unknown>;
  ip?: string | null;
  userAgent?: string | null;
}): Promise<WorkPatternAssignmentSummary> {
  assertManage(input.ctx);
  assertWorkspaceReadClaim(input.ctx, input.workspaceId);
  const memberId = typeof input.body.memberId === "string" ? input.body.memberId.trim() : "";
  const workPatternId =
    typeof input.body.workPatternId === "string" ? input.body.workPatternId.trim() : "";
  if (!isUuid(memberId) || !isUuid(workPatternId)) {
    throw new HttpError(400, "INVALID_ASSIGNMENT", "Karyawan dan pola kerja wajib dipilih");
  }
  const row = await withTenant(input.ctx, (db) =>
    db.$transaction(async (tx) => {
      const [member, pattern] = await Promise.all([
        tx.workspaceMember.findFirst({ where: { id: memberId, status: "ACTIVE" } }),
        tx.workPattern.findFirst({ where: { id: workPatternId, isActive: true } }),
      ]);
      if (!member) throw new HttpError(404, "MEMBER_NOT_FOUND", "Karyawan tidak ditemukan");
      if (!pattern) {
        throw new HttpError(404, "WORK_PATTERN_NOT_FOUND", "Pola kerja aktif tidak ditemukan");
      }
      const current = await tx.workPatternAssignment.findFirst({ where: { memberId } });
      const saved = current
        ? await tx.workPatternAssignment.update({
            where: { tenantId_id: { tenantId: input.ctx.tenantId, id: current.id } },
            data: { workPatternId },
            include: ASSIGNMENT_INCLUDE,
          })
        : await tx.workPatternAssignment.create({
            data: {
              id: randomUUID(),
              tenantId: input.ctx.tenantId,
              memberId,
              workPatternId,
            },
            include: ASSIGNMENT_INCLUDE,
          });
      await writeAudit(
        {
          tenantId: input.ctx.tenantId,
          actorType: "USER",
          actorUserId: input.ctx.userId,
          actorMemberId: input.ctx.memberId,
          action: "work_pattern.assign",
          resourceType: "work_pattern_assignment",
          resourceId: saved.id,
          metadata: {
            memberId,
            workPatternId,
            previousWorkPatternId: current?.workPatternId ?? null,
          },
          ip: input.ip ?? null,
          userAgent: input.userAgent ?? null,
        },
        tx,
      );
      return saved;
    }),
  );
  return toAssignment(row);
}

export async function removeWorkPatternAssignment(input: {
  ctx: TenantContext;
  workspaceId: string;
  memberId: string;
  ip?: string | null;
  userAgent?: string | null;
}): Promise<{ ok: true }> {
  assertManage(input.ctx);
  assertWorkspaceReadClaim(input.ctx, input.workspaceId);
  if (!isUuid(input.memberId)) {
    throw new HttpError(404, "ASSIGNMENT_NOT_FOUND", "Penugasan tidak ditemukan");
  }
  await withTenant(input.ctx, (db) =>
    db.$transaction(async (tx) => {
      const current = await tx.workPatternAssignment.findFirst({
        where: { memberId: input.memberId },
      });
      if (!current) {
        throw new HttpError(404, "ASSIGNMENT_NOT_FOUND", "Penugasan tidak ditemukan");
      }
      await tx.workPatternAssignment.delete({
        where: { tenantId_id: { tenantId: input.ctx.tenantId, id: current.id } },
      });
      await writeAudit(
        {
          tenantId: input.ctx.tenantId,
          actorType: "USER",
          actorUserId: input.ctx.userId,
          actorMemberId: input.ctx.memberId,
          action: "work_pattern.unassign",
          resourceType: "work_pattern_assignment",
          resourceId: current.id,
          metadata: { memberId: input.memberId, workPatternId: current.workPatternId },
          ip: input.ip ?? null,
          userAgent: input.userAgent ?? null,
        },
        tx,
      );
    }),
  );
  return { ok: true };
}
