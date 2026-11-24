import { randomUUID } from "node:crypto";

import {
  isUuid,
  withTenant,
  writeAudit,
  type Prisma,
  type TenantContext,
} from "@absensi/database";

import { reverseGeocodeCoordinates } from "./geocoding.js";
import { HttpError } from "./http.js";
import {
  storeClientVisitPhoto,
  type ClientVisitPhotoInput,
} from "./client-visit-proof.js";
import { parseReportDay } from "./reports.js";
import { assertWorkspaceReadClaim } from "./workspaces.js";

const DAY_MS = 86_400_000;
export const CLIENT_VISIT_RADIUS_MIN = 10;
export const CLIENT_VISIT_RADIUS_MAX = 10_000;
export const CLIENT_VISIT_TYPES = ["CHECK_IN", "CHECK_OUT"] as const;
export const CLIENT_VISIT_AD_HOC_TYPE = "AD_HOC";
export const CLIENT_VISIT_VALIDATION_STATUSES = ["VALID", "OUT_OF_RADIUS", "VOID"] as const;
export const CLIENT_VISIT_SCHEDULE_STATUSES = [
  "SCHEDULED",
  "IN_PROGRESS",
  "COMPLETED",
  "CANCELLED",
] as const;

export type ClientSummary = {
  id: string;
  name: string;
  picName: string;
  phone: string | null;
  address: string | null;
  latitude: number;
  longitude: number;
  radiusMeters: number;
  isActive: boolean;
};

export type ClientVisitLogSummary = {
  id: string;
  scheduleId: string | null;
  clientId: string | null;
  clientName: string;
  memberId: string;
  memberName: string;
  type: string;
  timestampServer: string;
  latitude: number;
  longitude: number;
  address: string | null;
  accuracyMeters: number;
  distanceMeters: number | null;
  isInsideRadius: boolean | null;
  photoUrl: string | null;
  notes: string | null;
  durationMinutes: number | null;
  validationStatus: string;
  reviewedAt: string | null;
};

export type ClientVisitExportRow = {
  id: string;
  memberName: string;
  positionName: string | null;
  clientName: string;
  checkInAt: string | null;
  checkOutAt: string | null;
  checkInPhotoFileName: string | null;
  checkOutPhotoFileName: string | null;
  checkInNotes: string | null;
  checkOutNotes: string | null;
  checkInAddress: string | null;
  checkOutAddress: string | null;
  checkInLatitude: number | null;
  checkInLongitude: number | null;
  checkOutLatitude: number | null;
  checkOutLongitude: number | null;
};

export type ClientVisitExportData = {
  companyName: string;
  rows: ClientVisitExportRow[];
};

export type ClientVisitScheduleSummary = {
  id: string;
  clientId: string;
  clientName: string;
  clientAddress: string | null;
  clientLatitude: number;
  clientLongitude: number;
  clientRadiusMeters: number;
  memberId: string;
  memberName: string;
  scheduledDate: string;
  plannedStartTime: string;
  plannedEndTime: string;
  purpose: string;
  status: string;
  visitStatus: "SCHEDULED" | "IN_PROGRESS" | "COMPLETED" | "MISSED" | "CANCELLED";
  checkIn: ClientVisitLogSummary | null;
  checkOut: ClientVisitLogSummary | null;
  logs: ClientVisitLogSummary[];
  createdAt: string;
};

export type ClientVisitSettingSummary = {
  defaultRadiusMeters: number;
  requirePhoto: boolean;
  requireCheckout: boolean;
  allowOutsideRadius: boolean;
};

export type ClientVisitSummary = {
  from: string;
  to: string;
  totalSchedules: number;
  completedSchedules: number;
  inProgressSchedules: number;
  missedSchedules: number;
  cancelledSchedules: number;
  completionRate: number;
  totalVisits: number;
  averageDurationMinutes: number;
  outOfRadiusVisits: number;
  perClient: Array<{
    clientId: string;
    clientName: string;
    schedules: number;
    completed: number;
    completionRate: number;
    visits: number;
    averageDurationMinutes: number;
    outOfRadius: number;
  }>;
};

export type ClientVisitInsight = {
  type: "POSITIVE" | "WARNING" | "INFO" | "RECOMMENDATION";
  title: string;
  detail: string;
};

function assertManage(ctx: TenantContext): void {
  if (
    !ctx.permissions.includes("member.manage") &&
    !ctx.roleKeys.includes("WORKSPACE_OWNER") &&
    !ctx.roleKeys.includes("WORKSPACE_ADMIN")
  ) {
    throw new HttpError(403, "FORBIDDEN", "Permission tidak mencukupi");
  }
}

function assertAttendanceRead(ctx: TenantContext): void {
  if (
    !ctx.permissions.includes("attendance.read") &&
    !ctx.roleKeys.includes("WORKSPACE_OWNER") &&
    !ctx.roleKeys.includes("WORKSPACE_ADMIN")
  ) {
    throw new HttpError(403, "FORBIDDEN", "Permission tidak mencukupi");
  }
}

function text(
  value: unknown,
  label: string,
  min: number,
  max: number,
  optional = false,
): string | null {
  if (value === undefined || value === null || value === "") {
    if (optional) return null;
    throw new HttpError(400, "INVALID_CLIENT_VISIT", `${label} wajib diisi`);
  }
  if (typeof value !== "string") {
    throw new HttpError(400, "INVALID_CLIENT_VISIT", `${label} tidak valid`);
  }
  const result = value.trim();
  if (result === "" && optional) return null;
  if (result.length < min || result.length > max) {
    throw new HttpError(400, "INVALID_CLIENT_VISIT", `${label} harus ${min}–${max} karakter`);
  }
  return result;
}

function coordinate(value: unknown, label: string, min: number, max: number): number {
  const number = typeof value === "string" && value.trim() !== "" ? Number(value) : value;
  if (typeof number !== "number" || !Number.isFinite(number) || number < min || number > max) {
    throw new HttpError(400, "INVALID_COORDINATE", `${label} tidak valid`);
  }
  return number;
}

function radius(value: unknown, fallback?: number): number {
  const raw = value === undefined || value === null ? fallback : Number(value);
  if (
    raw === undefined ||
    !Number.isInteger(raw) ||
    raw < CLIENT_VISIT_RADIUS_MIN ||
    raw > CLIENT_VISIT_RADIUS_MAX
  ) {
    throw new HttpError(
      400,
      "INVALID_RADIUS",
      `Radius ${CLIENT_VISIT_RADIUS_MIN}–${CLIENT_VISIT_RADIUS_MAX} meter`,
    );
  }
  return raw;
}

function time(value: unknown, label: string): string {
  if (typeof value !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) {
    throw new HttpError(400, "INVALID_TIME", `${label} harus berformat HH:MM`);
  }
  return value;
}

function dayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * DAY_MS);
}

export function haversineMeters(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const toRad = (value: number) => (value * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return Math.round(6_371_000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

function toClient(row: {
  id: string;
  name: string;
  picName: string;
  phone: string | null;
  address: string | null;
  latitude: number;
  longitude: number;
  radiusMeters: number;
  isActive: boolean;
}): ClientSummary {
  return { ...row };
}

function toLog(row: {
  id: string;
  scheduleId: string | null;
  clientId: string | null;
  clientName: string | null;
  memberId: string;
  type: string;
  timestampServer: Date;
  latitude: number;
  longitude: number;
  address: string | null;
  accuracyMeters: number;
  distanceMeters: number | null;
  isInsideRadius: boolean | null;
  photoUrl: string | null;
  notes: string | null;
  durationMinutes: number | null;
  validationStatus: string;
  reviewedAt: Date | null;
  client: { name: string } | null;
  member: { user: { name: string } };
}): ClientVisitLogSummary {
  return {
    id: row.id,
    scheduleId: row.scheduleId,
    clientId: row.clientId,
    clientName: row.client?.name ?? row.clientName ?? "Kunjungan client",
    memberId: row.memberId,
    memberName: row.member.user.name,
    type: row.type,
    timestampServer: row.timestampServer.toISOString(),
    latitude: row.latitude,
    longitude: row.longitude,
    address: row.address,
    accuracyMeters: row.accuracyMeters,
    distanceMeters: row.distanceMeters,
    isInsideRadius: row.isInsideRadius,
    photoUrl: row.photoUrl,
    notes: row.notes,
    durationMinutes: row.durationMinutes,
    validationStatus: row.validationStatus,
    reviewedAt: row.reviewedAt ? row.reviewedAt.toISOString() : null,
  };
}

const LOG_INCLUDE = {
  client: { select: { name: true } },
  member: { select: { user: { select: { name: true } } } },
} as const;

const SCHEDULE_INCLUDE: Prisma.ClientVisitScheduleInclude = {
  client: {
    select: {
      name: true,
      address: true,
      latitude: true,
      longitude: true,
      radiusMeters: true,
    },
  },
  member: { select: { user: { select: { name: true } } } },
  logs: {
    include: LOG_INCLUDE,
    orderBy: [{ timestampServer: "asc" }, { id: "asc" }],
  },
};

type ScheduleRow = {
  id: string;
  clientId: string;
  memberId: string;
  scheduledDate: Date;
  plannedStartTime: string;
  plannedEndTime: string;
  purpose: string;
  status: string;
  createdAt: Date;
  client: {
    name: string;
    address: string | null;
    latitude: number;
    longitude: number;
    radiusMeters: number;
  };
  member: { user: { name: string } };
  logs: Array<Parameters<typeof toLog>[0]>;
};

function toSchedule(
  row: ScheduleRow,
  today = new Date().toISOString().slice(0, 10),
): ClientVisitScheduleSummary {
  const checkInRow = row.logs.find((log) => log.type === "CHECK_IN") ?? null;
  const checkOutRow = row.logs.find((log) => log.type === "CHECK_OUT") ?? null;
  const scheduledDay = dayKey(row.scheduledDate);
  const visitStatus: ClientVisitScheduleSummary["visitStatus"] =
    row.status === "CANCELLED"
      ? "CANCELLED"
      : checkOutRow
        ? "COMPLETED"
        : checkInRow
          ? "IN_PROGRESS"
          : scheduledDay < today
            ? "MISSED"
            : "SCHEDULED";
  return {
    id: row.id,
    clientId: row.clientId,
    clientName: row.client.name,
    clientAddress: row.client.address,
    clientLatitude: row.client.latitude,
    clientLongitude: row.client.longitude,
    clientRadiusMeters: row.client.radiusMeters,
    memberId: row.memberId,
    memberName: row.member.user.name,
    scheduledDate: scheduledDay,
    plannedStartTime: row.plannedStartTime,
    plannedEndTime: row.plannedEndTime,
    purpose: row.purpose,
    status: row.status,
    visitStatus,
    checkIn: checkInRow ? toLog(checkInRow) : null,
    checkOut: checkOutRow ? toLog(checkOutRow) : null,
    logs: row.logs.map(toLog),
    createdAt: row.createdAt.toISOString(),
  };
}

export async function listClients(input: {
  ctx: TenantContext;
  workspaceId: string;
  search?: string | undefined;
  activeOnly?: boolean | undefined;
}): Promise<ClientSummary[]> {
  assertAttendanceRead(input.ctx);
  assertWorkspaceReadClaim(input.ctx, input.workspaceId);
  const search = input.search?.trim();
  const rows = await withTenant(input.ctx, (db) =>
    db.client.findMany({
      where: {
        ...(input.activeOnly ? { isActive: true } : {}),
        ...(search
          ? {
              OR: [
                { name: { contains: search } },
                { picName: { contains: search } },
                { phone: { contains: search } },
              ],
            }
          : {}),
      },
      orderBy: [{ isActive: "desc" }, { name: "asc" }],
      take: 500,
    }),
  );
  return rows.map(toClient);
}

export async function createClient(input: {
  ctx: TenantContext;
  workspaceId: string;
  body: Record<string, unknown>;
  ip?: string | null;
  userAgent?: string | null;
}): Promise<ClientSummary> {
  assertManage(input.ctx);
  assertWorkspaceReadClaim(input.ctx, input.workspaceId);
  const name = text(input.body.name, "Nama client", 2, 160) as string;
  const picName = text(input.body.picName, "Nama PIC", 2, 120) as string;
  const phone = text(input.body.phone, "Telepon", 3, 40, true);
  const address = text(input.body.address, "Alamat", 3, 500, true);
  const latitude = coordinate(input.body.latitude, "Latitude", -90, 90);
  const longitude = coordinate(input.body.longitude, "Longitude", -180, 180);
  const radiusMeters = radius(input.body.radiusMeters);
  const id = randomUUID();
  try {
    const row = await withTenant(input.ctx, (db) =>
      db.$transaction(async (tx) => {
        const saved = await tx.client.create({
          data: {
            id,
            tenantId: input.ctx.tenantId,
            name,
            picName,
            phone,
            address,
            latitude,
            longitude,
            radiusMeters,
          },
        });
        await writeAudit(
          {
            tenantId: input.ctx.tenantId,
            actorType: "USER",
            actorUserId: input.ctx.userId,
            actorMemberId: input.ctx.memberId,
            action: "client.create",
            resourceType: "client",
            resourceId: id,
            metadata: { name, radiusMeters },
            ip: input.ip ?? null,
            userAgent: input.userAgent ?? null,
          },
          tx,
        );
        return saved;
      }),
    );
    return toClient(row);
  } catch (error) {
    if ((error as { code?: string }).code === "P2002") {
      throw new HttpError(409, "CLIENT_NAME_EXISTS", "Nama client sudah dipakai");
    }
    throw error;
  }
}

export async function updateClient(input: {
  ctx: TenantContext;
  workspaceId: string;
  clientId: string;
  body: Record<string, unknown>;
  ip?: string | null;
  userAgent?: string | null;
}): Promise<ClientSummary> {
  assertManage(input.ctx);
  assertWorkspaceReadClaim(input.ctx, input.workspaceId);
  if (!isUuid(input.clientId)) {
    throw new HttpError(404, "CLIENT_NOT_FOUND", "Client tidak ditemukan");
  }
  const existing = await withTenant(input.ctx, (db) =>
    db.client.findFirst({ where: { id: input.clientId } }),
  );
  if (!existing) throw new HttpError(404, "CLIENT_NOT_FOUND", "Client tidak ditemukan");
  const name = input.body.name === undefined ? existing.name : (text(input.body.name, "Nama client", 2, 160) as string);
  const picName = input.body.picName === undefined ? existing.picName : (text(input.body.picName, "Nama PIC", 2, 120) as string);
  const phone = input.body.phone === undefined ? existing.phone : text(input.body.phone, "Telepon", 3, 40, true);
  const address = input.body.address === undefined ? existing.address : text(input.body.address, "Alamat", 3, 500, true);
  const latitude = input.body.latitude === undefined ? existing.latitude : coordinate(input.body.latitude, "Latitude", -90, 90);
  const longitude = input.body.longitude === undefined ? existing.longitude : coordinate(input.body.longitude, "Longitude", -180, 180);
  const radiusMeters = input.body.radiusMeters === undefined ? existing.radiusMeters : radius(input.body.radiusMeters);
  const isActive = input.body.isActive === undefined ? existing.isActive : Boolean(input.body.isActive);
  try {
    const row = await withTenant(input.ctx, (db) =>
      db.$transaction(async (tx) => {
        const saved = await tx.client.update({
          where: { tenantId_id: { tenantId: input.ctx.tenantId, id: existing.id } },
          data: { name, picName, phone, address, latitude, longitude, radiusMeters, isActive },
        });
        await writeAudit(
          {
            tenantId: input.ctx.tenantId,
            actorType: "USER",
            actorUserId: input.ctx.userId,
            actorMemberId: input.ctx.memberId,
            action: "client.update",
            resourceType: "client",
            resourceId: saved.id,
            metadata: { name, radiusMeters, isActive },
            ip: input.ip ?? null,
            userAgent: input.userAgent ?? null,
          },
          tx,
        );
        return saved;
      }),
    );
    return toClient(row);
  } catch (error) {
    if ((error as { code?: string }).code === "P2002") {
      throw new HttpError(409, "CLIENT_NAME_EXISTS", "Nama client sudah dipakai");
    }
    throw error;
  }
}

export async function getClientVisitSettings(input: {
  ctx: TenantContext;
  workspaceId: string;
}): Promise<ClientVisitSettingSummary> {
  assertAttendanceRead(input.ctx);
  assertWorkspaceReadClaim(input.ctx, input.workspaceId);
  return withTenant(input.ctx, async (db) => {
    const row = await db.clientVisitSetting.findFirst();
    return {
      defaultRadiusMeters: row?.defaultRadiusMeters ?? 100,
      requirePhoto: row?.requirePhoto ?? true,
      requireCheckout: row?.requireCheckout ?? true,
      allowOutsideRadius: row?.allowOutsideRadius ?? true,
    };
  });
}

export async function updateClientVisitSettings(input: {
  ctx: TenantContext;
  workspaceId: string;
  body: Record<string, unknown>;
  ip?: string | null;
  userAgent?: string | null;
}): Promise<ClientVisitSettingSummary> {
  assertManage(input.ctx);
  assertWorkspaceReadClaim(input.ctx, input.workspaceId);
  const existing = await getClientVisitSettings(input);
  const defaultRadiusMeters =
    input.body.defaultRadiusMeters === undefined
      ? existing.defaultRadiusMeters
      : radius(input.body.defaultRadiusMeters);
  const requirePhoto =
    input.body.requirePhoto === undefined ? existing.requirePhoto : Boolean(input.body.requirePhoto);
  const requireCheckout =
    input.body.requireCheckout === undefined ? existing.requireCheckout : Boolean(input.body.requireCheckout);
  const allowOutsideRadius =
    input.body.allowOutsideRadius === undefined
      ? existing.allowOutsideRadius
      : Boolean(input.body.allowOutsideRadius);
  const row = await withTenant(input.ctx, (db) =>
    db.$transaction(async (tx) => {
      const saved = await tx.clientVisitSetting.upsert({
        where: { tenantId: input.ctx.tenantId },
        update: { defaultRadiusMeters, requirePhoto, requireCheckout, allowOutsideRadius },
        create: {
          id: randomUUID(),
          tenantId: input.ctx.tenantId,
          defaultRadiusMeters,
          requirePhoto,
          requireCheckout,
          allowOutsideRadius,
        },
      });
      await writeAudit(
        {
          tenantId: input.ctx.tenantId,
          actorType: "USER",
          actorUserId: input.ctx.userId,
          actorMemberId: input.ctx.memberId,
          action: "client_visit.settings_update",
          resourceType: "client_visit_setting",
          resourceId: saved.id,
          metadata: { defaultRadiusMeters, requirePhoto, requireCheckout, allowOutsideRadius },
          ip: input.ip ?? null,
          userAgent: input.userAgent ?? null,
        },
        tx,
      );
      return saved;
    }),
  );
  return {
    defaultRadiusMeters: row.defaultRadiusMeters,
    requirePhoto: row.requirePhoto,
    requireCheckout: row.requireCheckout,
    allowOutsideRadius: row.allowOutsideRadius,
  };
}

export async function createClientVisitSchedule(input: {
  ctx: TenantContext;
  workspaceId: string;
  body: Record<string, unknown>;
  ip?: string | null;
  userAgent?: string | null;
}): Promise<ClientVisitScheduleSummary> {
  assertManage(input.ctx);
  assertWorkspaceReadClaim(input.ctx, input.workspaceId);
  if (typeof input.body.clientId !== "string" || !isUuid(input.body.clientId)) {
    throw new HttpError(400, "INVALID_CLIENT", "Client tidak valid");
  }
  if (typeof input.body.memberId !== "string" || !isUuid(input.body.memberId)) {
    throw new HttpError(400, "INVALID_MEMBER", "Karyawan tidak valid");
  }
  const scheduledDate = parseReportDay(
    typeof input.body.scheduledDate === "string" ? input.body.scheduledDate : "",
    "scheduledDate",
  );
  const plannedStartTime = time(input.body.plannedStartTime, "Jam mulai");
  const plannedEndTime = time(input.body.plannedEndTime, "Jam selesai");
  if (plannedEndTime <= plannedStartTime) {
    throw new HttpError(400, "INVALID_TIME_RANGE", "Jam selesai harus setelah jam mulai");
  }
  const purpose = text(input.body.purpose, "Tujuan kunjungan", 3, 1000) as string;
  const id = randomUUID();
  const row = await withTenant(input.ctx, (db) =>
    db.$transaction(async (tx) => {
      const [client, member] = await Promise.all([
        tx.client.findFirst({ where: { id: input.body.clientId as string, isActive: true } }),
        tx.workspaceMember.findFirst({
          where: { id: input.body.memberId as string, status: "ACTIVE" },
        }),
      ]);
      if (!client) throw new HttpError(404, "CLIENT_NOT_FOUND", "Client aktif tidak ditemukan");
      if (!member) throw new HttpError(404, "MEMBER_NOT_FOUND", "Karyawan aktif tidak ditemukan");
      const saved = await tx.clientVisitSchedule.create({
        data: {
          id,
          tenantId: input.ctx.tenantId,
          clientId: client.id,
          memberId: member.id,
          scheduledDate,
          plannedStartTime,
          plannedEndTime,
          purpose,
          createdByMemberId: input.ctx.memberId,
        },
        include: SCHEDULE_INCLUDE,
      });
      await writeAudit(
        {
          tenantId: input.ctx.tenantId,
          actorType: "USER",
          actorUserId: input.ctx.userId,
          actorMemberId: input.ctx.memberId,
          action: "client_visit.schedule_create",
          resourceType: "client_visit_schedule",
          resourceId: id,
          metadata: {
            clientId: client.id,
            memberId: member.id,
            scheduledDate: dayKey(scheduledDate),
          },
          ip: input.ip ?? null,
          userAgent: input.userAgent ?? null,
        },
        tx,
      );
      return saved;
    }),
  );
  return toSchedule(row as unknown as ScheduleRow);
}

export async function listWorkspaceClientVisitSchedules(input: {
  ctx: TenantContext;
  workspaceId: string;
  date?: string | undefined;
  from?: string | undefined;
  to?: string | undefined;
  memberId?: string | undefined;
  clientId?: string | undefined;
  status?: string | undefined;
}): Promise<ClientVisitScheduleSummary[]> {
  assertAttendanceRead(input.ctx);
  assertWorkspaceReadClaim(input.ctx, input.workspaceId);
  const from = input.from ? parseReportDay(input.from, "from") : undefined;
  const to = input.to ? parseReportDay(input.to, "to") : undefined;
  const date = input.date ? parseReportDay(input.date, "date") : undefined;
  if (from && to && from.getTime() > to.getTime()) {
    throw new HttpError(400, "INVALID_DATE_RANGE", "Rentang tanggal tidak valid");
  }
  const status = input.status?.trim().toUpperCase();
  if (
    status &&
    status !== "ALL" &&
    !(CLIENT_VISIT_SCHEDULE_STATUSES as readonly string[]).includes(status)
  ) {
    throw new HttpError(400, "INVALID_STATUS", "Status jadwal tidak valid");
  }
  const rows = await withTenant(input.ctx, (db) =>
    db.clientVisitSchedule.findMany({
      where: {
        ...(date ? { scheduledDate: date } : {}),
        ...(from ? { scheduledDate: { gte: from } } : {}),
        ...(to ? { scheduledDate: { lte: to } } : {}),
        ...(input.memberId ? { memberId: input.memberId } : {}),
        ...(input.clientId ? { clientId: input.clientId } : {}),
        ...(status && status !== "ALL" ? { status } : {}),
      },
      include: SCHEDULE_INCLUDE,
      orderBy: [{ scheduledDate: "desc" }, { plannedStartTime: "asc" }],
      take: 500,
    }),
  );
  return rows.map((row) => toSchedule(row as unknown as ScheduleRow));
}

export async function listMyClientVisits(input: {
  ctx: TenantContext;
  date?: string | undefined;
  now?: Date | undefined;
}): Promise<{
  date: string;
  schedules: ClientVisitScheduleSummary[];
  history: ClientVisitScheduleSummary[];
}> {
  const date = input.date
    ? parseReportDay(input.date, "date")
    : parseReportDay(dayKey(input.now ?? new Date()), "date");
  const [schedules, history] = await withTenant(input.ctx, (db) =>
    Promise.all([
      db.clientVisitSchedule.findMany({
        where: { memberId: input.ctx.memberId, scheduledDate: date },
        include: SCHEDULE_INCLUDE,
        orderBy: [{ plannedStartTime: "asc" }, { id: "asc" }],
      }),
      db.clientVisitSchedule.findMany({
        where: { memberId: input.ctx.memberId, scheduledDate: { lt: date } },
        include: SCHEDULE_INCLUDE,
        orderBy: [{ scheduledDate: "desc" }, { plannedStartTime: "desc" }],
        take: 40,
      }),
    ]),
  );
  const today = dayKey(input.now ?? new Date());
  return {
    date: dayKey(date),
    schedules: schedules.map((row) => toSchedule(row as unknown as ScheduleRow, today)),
    history: history.map((row) => toSchedule(row as unknown as ScheduleRow, today)),
  };
}

export async function recordClientVisit(input: {
  ctx: TenantContext;
  scheduleId: string;
  type: string;
  latitude: unknown;
  longitude: unknown;
  accuracyMeters: unknown;
  notes?: unknown;
  photo?: ClientVisitPhotoInput | undefined;
  now?: Date;
  ip?: string | null;
  userAgent?: string | null;
}): Promise<ClientVisitLogSummary> {
  if (!input.ctx.permissions.includes("workspace.read") && !input.ctx.permissions.includes("workspace.manage")) {
    throw new HttpError(403, "FORBIDDEN", "Permission tidak mencukupi");
  }
  if (!isUuid(input.scheduleId)) {
    throw new HttpError(404, "CLIENT_VISIT_NOT_FOUND", "Jadwal kunjungan tidak ditemukan");
  }
  const type = input.type?.trim().toUpperCase();
  if (!(CLIENT_VISIT_TYPES as readonly string[]).includes(type)) {
    throw new HttpError(400, "INVALID_VISIT_TYPE", "Tipe kunjungan tidak valid");
  }
  const latitude = coordinate(input.latitude, "Latitude", -90, 90);
  const longitude = coordinate(input.longitude, "Longitude", -180, 180);
  const accuracyMeters = Number(input.accuracyMeters);
  if (!Number.isFinite(accuracyMeters) || accuracyMeters < 0 || accuracyMeters > 100_000) {
    throw new HttpError(400, "INVALID_ACCURACY", "Akurasi GPS tidak valid");
  }
  const notes = text(input.notes, "Catatan", 0, 1000, true);
  const address = await reverseGeocodeCoordinates(latitude, longitude);
  const now = input.now ?? new Date();
  const today = dayKey(now);

  const schedule = await withTenant(input.ctx, (db) =>
    db.clientVisitSchedule.findFirst({
      where: { id: input.scheduleId, memberId: input.ctx.memberId },
      include: { client: true, logs: true },
    }),
  );
  if (!schedule) {
    throw new HttpError(404, "CLIENT_VISIT_NOT_FOUND", "Jadwal kunjungan tidak ditemukan");
  }
  if (schedule.status === "CANCELLED") {
    throw new HttpError(409, "VISIT_CANCELLED", "Jadwal kunjungan telah dibatalkan");
  }
  if (dayKey(schedule.scheduledDate) !== today) {
    throw new HttpError(409, "VISIT_NOT_TODAY", "Kunjungan hanya dapat dicatat pada tanggal jadwal");
  }
  const existing = schedule.logs.find((log) => log.type === type);
  if (existing) {
    throw new HttpError(409, "VISIT_ALREADY_RECORDED", `Kunjungan ${type} sudah dicatat`);
  }
  if (type === "CHECK_OUT" && !schedule.logs.some((log) => log.type === "CHECK_IN")) {
    throw new HttpError(409, "VISIT_NOT_CHECKED_IN", "Belum ada check-in untuk jadwal ini");
  }
  const settings = await withTenant(input.ctx, (db) => db.clientVisitSetting.findFirst());
  const requirePhoto = settings?.requirePhoto ?? true;
  if (requirePhoto && !input.photo) {
    throw new HttpError(400, "VISIT_PHOTO_REQUIRED", "Foto bukti kunjungan wajib diunggah");
  }
  const distanceMeters = haversineMeters(
    latitude,
    longitude,
    schedule.client.latitude,
    schedule.client.longitude,
  );
  const isInsideRadius = distanceMeters <= schedule.client.radiusMeters;
  if (!isInsideRadius && settings?.allowOutsideRadius === false) {
    throw new HttpError(403, "OUTSIDE_CLIENT_RADIUS", "Anda berada di luar radius client");
  }

  const logId = randomUUID();
  let photoFields: {
    photoUrl: string;
    photoHash: string;
    photoFileName: string;
    photoContentType: string;
  } | null = null;
  if (input.photo) {
    const stored = await storeClientVisitPhoto(logId, input.photo);
    photoFields = {
      photoUrl: `/api/mobile/client-visits/logs/${logId}/photo`,
      ...stored,
    };
  }
  const checkIn = schedule.logs.find((log) => log.type === "CHECK_IN");
  const durationMinutes =
    type === "CHECK_OUT" && checkIn
      ? Math.max(0, Math.round((now.getTime() - checkIn.timestampServer.getTime()) / 60_000))
      : null;

  const row = await withTenant(input.ctx, (db) =>
    db.$transaction(async (tx) => {
      const created = await tx.clientVisitLog.create({
        data: {
          id: logId,
          tenantId: input.ctx.tenantId,
          scheduleId: schedule.id,
          clientId: schedule.clientId,
          memberId: input.ctx.memberId,
          type,
          timestampServer: now,
          latitude,
          longitude,
          address,
          accuracyMeters,
          distanceMeters,
          isInsideRadius,
          ...(photoFields ?? {}),
          notes,
          durationMinutes,
          validationStatus: isInsideRadius ? "VALID" : "OUT_OF_RADIUS",
        },
        include: LOG_INCLUDE,
      });
      await tx.clientVisitSchedule.update({
        where: { tenantId_id: { tenantId: input.ctx.tenantId, id: schedule.id } },
        data: { status: type === "CHECK_IN" ? "IN_PROGRESS" : "COMPLETED" },
      });
      await writeAudit(
        {
          tenantId: input.ctx.tenantId,
          actorType: "USER",
          actorUserId: input.ctx.userId,
          actorMemberId: input.ctx.memberId,
          action: type === "CHECK_IN" ? "client_visit.check_in" : "client_visit.check_out",
          resourceType: "client_visit_log",
          resourceId: logId,
          metadata: {
            scheduleId: schedule.id,
            clientId: schedule.clientId,
            distanceMeters,
            isInsideRadius,
            hasPhoto: Boolean(photoFields),
          },
          ip: input.ip ?? null,
          userAgent: input.userAgent ?? null,
        },
        tx,
      );
      return created;
    }),
  );
  return toLog(row);
}

export async function recordAdHocClientVisit(input: {
  ctx: TenantContext;
  clientName: unknown;
  latitude: unknown;
  longitude: unknown;
  accuracyMeters: unknown;
  notes: unknown;
  photo?: ClientVisitPhotoInput | undefined;
  now?: Date;
  ip?: string | null;
  userAgent?: string | null;
}): Promise<ClientVisitLogSummary> {
  if (
    !input.ctx.permissions.includes("workspace.read") &&
    !input.ctx.permissions.includes("workspace.manage")
  ) {
    throw new HttpError(403, "FORBIDDEN", "Permission tidak mencukupi");
  }
  const clientName = text(input.clientName, "Nama client", 2, 160) as string;
  const notes = text(input.notes, "Keterangan kunjungan", 3, 1000) as string;
  const latitude = coordinate(input.latitude, "Latitude", -90, 90);
  const longitude = coordinate(input.longitude, "Longitude", -180, 180);
  const accuracyMeters = Number(input.accuracyMeters);
  if (!Number.isFinite(accuracyMeters) || accuracyMeters < 0 || accuracyMeters > 100_000) {
    throw new HttpError(400, "INVALID_ACCURACY", "Akurasi GPS tidak valid");
  }
  const address = await reverseGeocodeCoordinates(latitude, longitude);
  const settings = await withTenant(input.ctx, (db) =>
    db.clientVisitSetting.findFirst(),
  );
  if ((settings?.requirePhoto ?? true) && !input.photo) {
    throw new HttpError(400, "VISIT_PHOTO_REQUIRED", "Foto bukti kunjungan wajib diunggah");
  }

  const logId = randomUUID();
  const stored = input.photo ? await storeClientVisitPhoto(logId, input.photo) : null;
  const now = input.now ?? new Date();
  const row = await withTenant(input.ctx, (db) =>
    db.$transaction(async (tx) => {
      const created = await tx.clientVisitLog.create({
        data: {
          id: logId,
          tenantId: input.ctx.tenantId,
          scheduleId: null,
          clientId: null,
          clientName,
          memberId: input.ctx.memberId,
          type: CLIENT_VISIT_AD_HOC_TYPE,
          timestampServer: now,
          latitude,
          longitude,
          address,
          accuracyMeters,
          distanceMeters: null,
          isInsideRadius: null,
          ...(stored
            ? {
                photoUrl: `/api/mobile/client-visits/logs/${logId}/photo`,
                photoHash: stored.photoHash,
                photoFileName: stored.photoFileName,
                photoContentType: stored.photoContentType,
              }
            : {}),
          notes,
          validationStatus: "VALID",
        },
        include: LOG_INCLUDE,
      });
      await writeAudit(
        {
          tenantId: input.ctx.tenantId,
          actorType: "USER",
          actorUserId: input.ctx.userId,
          actorMemberId: input.ctx.memberId,
          action: "client_visit.adhoc_create",
          resourceType: "client_visit_log",
          resourceId: logId,
          metadata: {
            clientName,
            accuracyMeters,
            notesLength: notes.length,
            hasPhoto: Boolean(stored),
          },
          ip: input.ip ?? null,
          userAgent: input.userAgent ?? null,
        },
        tx,
      );
      return created;
    }),
  );
  return toLog(row);
}

export async function listWorkspaceClientVisitLogs(input: {
  ctx: TenantContext;
  workspaceId: string;
  from?: string | undefined;
  to?: string | undefined;
  memberId?: string | undefined;
  clientId?: string | undefined;
  validationStatus?: string | undefined;
}): Promise<ClientVisitLogSummary[]> {
  assertAttendanceRead(input.ctx);
  assertWorkspaceReadClaim(input.ctx, input.workspaceId);
  const from = input.from ? parseReportDay(input.from, "from") : undefined;
  const to = input.to ? parseReportDay(input.to, "to") : undefined;
  const status = input.validationStatus?.trim().toUpperCase();
  if (
    status &&
    status !== "ALL" &&
    !(CLIENT_VISIT_VALIDATION_STATUSES as readonly string[]).includes(status)
  ) {
    throw new HttpError(400, "INVALID_STATUS", "Status validasi tidak valid");
  }
  const rows = await withTenant(input.ctx, (db) =>
    db.clientVisitLog.findMany({
      where: {
        ...(from || to
          ? {
              timestampServer: {
                ...(from ? { gte: from } : {}),
                ...(to ? { lt: addDays(to, 1) } : {}),
              },
            }
          : {}),
        ...(input.memberId ? { memberId: input.memberId } : {}),
        ...(input.clientId ? { clientId: input.clientId } : {}),
        ...(status && status !== "ALL" ? { validationStatus: status } : {}),
      },
      include: LOG_INCLUDE,
      orderBy: [{ timestampServer: "desc" }, { id: "desc" }],
      take: 500,
    }),
  );
  return rows.map(toLog);
}

export async function listWorkspaceClientVisitExportRows(input: {
  ctx: TenantContext;
  workspaceId: string;
  from?: string | undefined;
  to?: string | undefined;
  memberId?: string | undefined;
}): Promise<ClientVisitExportData> {
  assertAttendanceRead(input.ctx);
  assertWorkspaceReadClaim(input.ctx, input.workspaceId);
  const from = input.from ? parseReportDay(input.from, "from") : undefined;
  const to = input.to ? parseReportDay(input.to, "to") : undefined;
  if (from && to && from.getTime() > to.getTime()) {
    throw new HttpError(400, "INVALID_DATE_RANGE", "Rentang tanggal tidak valid");
  }
  const [logs, profile, workspace] = await withTenant(input.ctx, (db) =>
    Promise.all([
      db.clientVisitLog.findMany({
        where: {
          ...(from || to
            ? {
                timestampServer: {
                  ...(from ? { gte: from } : {}),
                  ...(to ? { lt: addDays(to, 1) } : {}),
                },
              }
            : {}),
          ...(input.memberId ? { memberId: input.memberId } : {}),
        },
        include: {
          client: { select: { name: true } },
          member: {
            select: {
              user: { select: { name: true } },
              position: { select: { name: true } },
            },
          },
        },
        orderBy: [{ timestampServer: "asc" }, { id: "asc" }],
        take: 5000,
      }),
      db.companyProfile.findFirst({ select: { legalName: true } }),
      db.workspace.findFirst({ select: { name: true } }),
    ]),
  );

  type ExportLog = (typeof logs)[number];
  const scheduled = new Map<
    string,
    { checkIn?: ExportLog; checkOut?: ExportLog }
  >();
  const adHoc: ExportLog[] = [];
  for (const log of logs) {
    if (!log.scheduleId) {
      adHoc.push(log);
      continue;
    }
    const entry = scheduled.get(log.scheduleId) ?? {};
    if (log.type === "CHECK_IN") entry.checkIn = log;
    else if (log.type === "CHECK_OUT") entry.checkOut = log;
    scheduled.set(log.scheduleId, entry);
  }

  const toExportRow = (
    checkIn: ExportLog | undefined,
    checkOut: ExportLog | undefined,
    anchor: ExportLog,
  ): ClientVisitExportRow => ({
    id: anchor.scheduleId ?? anchor.id,
    memberName: anchor.member.user.name,
    positionName: anchor.member.position?.name ?? null,
    clientName: anchor.client?.name ?? anchor.clientName ?? "Kunjungan client",
    checkInAt: checkIn ? checkIn.timestampServer.toISOString() : null,
    checkOutAt: checkOut ? checkOut.timestampServer.toISOString() : null,
    checkInPhotoFileName: checkIn?.photoFileName ?? null,
    checkOutPhotoFileName: checkOut?.photoFileName ?? null,
    checkInNotes: checkIn?.notes ?? null,
    checkOutNotes: checkOut?.notes ?? null,
    checkInAddress: checkIn?.address ?? null,
    checkOutAddress: checkOut?.address ?? null,
    checkInLatitude: checkIn?.latitude ?? null,
    checkInLongitude: checkIn?.longitude ?? null,
    checkOutLatitude: checkOut?.latitude ?? null,
    checkOutLongitude: checkOut?.longitude ?? null,
  });

  const rows: ClientVisitExportRow[] = [];
  for (const entry of scheduled.values()) {
    const anchor = entry.checkIn ?? entry.checkOut;
    if (anchor) rows.push(toExportRow(entry.checkIn, entry.checkOut, anchor));
  }
  for (const log of adHoc) rows.push(toExportRow(log, undefined, log));
  rows.sort((left, right) =>
    (left.checkInAt ?? left.checkOutAt ?? "").localeCompare(
      right.checkInAt ?? right.checkOutAt ?? "",
    ),
  );

  return {
    companyName: profile?.legalName ?? workspace?.name ?? "Perusahaan",
    rows,
  };
}

export async function reviewClientVisitLog(input: {
  ctx: TenantContext;
  workspaceId: string;
  logId: string;
  validationStatus: unknown;
  ip?: string | null;
  userAgent?: string | null;
}): Promise<ClientVisitLogSummary> {
  assertManage(input.ctx);
  assertWorkspaceReadClaim(input.ctx, input.workspaceId);
  if (!isUuid(input.logId)) {
    throw new HttpError(404, "CLIENT_VISIT_NOT_FOUND", "Kunjungan tidak ditemukan");
  }
  const status =
    typeof input.validationStatus === "string" ? input.validationStatus.toUpperCase() : "";
  if (status !== "VALID" && status !== "VOID") {
    throw new HttpError(400, "INVALID_STATUS", "Status validasi harus VALID atau VOID");
  }
  const row = await withTenant(input.ctx, (db) =>
    db.$transaction(async (tx) => {
      const existing = await tx.clientVisitLog.findFirst({ where: { id: input.logId } });
      if (!existing) throw new HttpError(404, "CLIENT_VISIT_NOT_FOUND", "Kunjungan tidak ditemukan");
      const updated = await tx.clientVisitLog.update({
        where: { tenantId_id: { tenantId: input.ctx.tenantId, id: existing.id } },
        data: {
          validationStatus: status,
          reviewedByMemberId: input.ctx.memberId,
          reviewedAt: new Date(),
        },
        include: LOG_INCLUDE,
      });
      await writeAudit(
        {
          tenantId: input.ctx.tenantId,
          actorType: "USER",
          actorUserId: input.ctx.userId,
          actorMemberId: input.ctx.memberId,
          action: "client_visit.review",
          resourceType: "client_visit_log",
          resourceId: updated.id,
          metadata: { validationStatus: status, memberId: updated.memberId },
          ip: input.ip ?? null,
          userAgent: input.userAgent ?? null,
        },
        tx,
      );
      return updated;
    }),
  );
  return toLog(row);
}

export async function getClientVisitSummary(input: {
  ctx: TenantContext;
  workspaceId: string;
  from?: string | undefined;
  to?: string | undefined;
  now?: Date | undefined;
}): Promise<ClientVisitSummary> {
  assertAttendanceRead(input.ctx);
  assertWorkspaceReadClaim(input.ctx, input.workspaceId);
  const today = parseReportDay(dayKey(input.now ?? new Date()), "date");
  const to = input.to ? parseReportDay(input.to, "to") : today;
  const from = input.from ? parseReportDay(input.from, "from") : addDays(to, -29);
  if (from.getTime() > to.getTime()) {
    throw new HttpError(400, "INVALID_DATE_RANGE", "Rentang tanggal tidak valid");
  }
  const rows = await withTenant(input.ctx, (db) =>
    db.clientVisitSchedule.findMany({
      where: { scheduledDate: { gte: from, lte: to } },
      include: { client: { select: { id: true, name: true } }, logs: true },
      orderBy: [{ scheduledDate: "asc" }, { id: "asc" }],
    }),
  );
  const clients = new Map<
    string,
    { clientName: string; schedules: number; completed: number; visits: number; durations: number[]; outOfRadius: number }
  >();
  let completedSchedules = 0;
  let inProgressSchedules = 0;
  let missedSchedules = 0;
  let cancelledSchedules = 0;
  let totalVisits = 0;
  let durationSum = 0;
  let durationCount = 0;
  let outOfRadiusVisits = 0;
  const todayKey = dayKey(today);

  for (const row of rows) {
    const entry = clients.get(row.clientId) ?? {
      clientName: row.client.name,
      schedules: 0,
      completed: 0,
      visits: 0,
      durations: [],
      outOfRadius: 0,
    };
    entry.schedules += 1;
    const checkIns = row.logs.filter((log) => log.type === "CHECK_IN");
    const checkOut = row.logs.find((log) => log.type === "CHECK_OUT");
    if (row.status === "CANCELLED") {
      cancelledSchedules += 1;
    } else if (checkOut) {
      completedSchedules += 1;
      entry.completed += 1;
      if (checkOut.durationMinutes !== null) {
        durationSum += checkOut.durationMinutes;
        durationCount += 1;
        entry.durations.push(checkOut.durationMinutes);
      }
    } else if (checkIns.length > 0) {
      inProgressSchedules += 1;
    } else if (dayKey(row.scheduledDate) < todayKey) {
      missedSchedules += 1;
    }
    for (const log of checkIns) {
      totalVisits += 1;
      entry.visits += 1;
      if (log.isInsideRadius === false) {
        outOfRadiusVisits += 1;
        entry.outOfRadius += 1;
      }
    }
    clients.set(row.clientId, entry);
  }
  return {
    from: dayKey(from),
    to: dayKey(to),
    totalSchedules: rows.length,
    completedSchedules,
    inProgressSchedules,
    missedSchedules,
    cancelledSchedules,
    completionRate:
      rows.length === 0 ? 0 : Math.round((completedSchedules / rows.length) * 100),
    totalVisits,
    averageDurationMinutes: durationCount === 0 ? 0 : Math.round(durationSum / durationCount),
    outOfRadiusVisits,
    perClient: [...clients.entries()]
      .map(([clientId, entry]) => ({
        clientId,
        clientName: entry.clientName,
        schedules: entry.schedules,
        completed: entry.completed,
        completionRate:
          entry.schedules === 0 ? 0 : Math.round((entry.completed / entry.schedules) * 100),
        visits: entry.visits,
        averageDurationMinutes:
          entry.durations.length === 0
            ? 0
            : Math.round(entry.durations.reduce((sum, value) => sum + value, 0) / entry.durations.length),
        outOfRadius: entry.outOfRadius,
      }))
      .sort((a, b) => b.visits - a.visits || a.clientName.localeCompare(b.clientName)),
  };
}

export async function getClientVisitInsights(input: {
  ctx: TenantContext;
  workspaceId: string;
  from?: string | undefined;
  to?: string | undefined;
  now?: Date | undefined;
}): Promise<{ summary: ClientVisitSummary; insights: ClientVisitInsight[] }> {
  const summary = await getClientVisitSummary(input);
  const insights: ClientVisitInsight[] = [];
  if (summary.totalSchedules === 0) {
    insights.push({
      type: "INFO",
      title: "Belum ada jadwal kunjungan",
      detail: "Buat jadwal kunjungan client agar penyelesaian dan produktivitas lapangan dapat dipantau.",
    });
  } else {
    if (summary.completionRate >= 90) {
      insights.push({
        type: "POSITIVE",
        title: "Penyelesaian jadwal sangat baik",
        detail: `${summary.completedSchedules} dari ${summary.totalSchedules} jadwal selesai (${summary.completionRate}%).`,
      });
    } else if (summary.completionRate < 70) {
      insights.push({
        type: "WARNING",
        title: "Penyelesaian jadwal perlu perhatian",
        detail: `Tingkat penyelesaian ${summary.completionRate}%. Tinjau ${summary.missedSchedules} jadwal terlewat dan beban kunjungan per karyawan.`,
      });
    }
    if (summary.outOfRadiusVisits > 0) {
      insights.push({
        type: "WARNING",
        title: "Kunjungan di luar radius client",
        detail: `${summary.outOfRadiusVisits} check-in tercatat di luar radius. Verifikasi bukti foto dan koordinat sebelum validasi.`,
      });
    }
    if (summary.averageDurationMinutes > 90) {
      insights.push({
        type: "RECOMMENDATION",
        title: "Durasi kunjungan cenderung panjang",
        detail: `Rata-rata kunjungan ${summary.averageDurationMinutes} menit. Pertimbangkan membagi kunjungan atau menambah buffer antarjadwal.`,
      });
    }
    const top = summary.perClient[0];
    if (top && top.visits > 0) {
      insights.push({
        type: "INFO",
        title: "Client paling sering dikunjungi",
        detail: `${top.clientName} menerima ${top.visits} kunjungan dengan rata-rata durasi ${top.averageDurationMinutes} menit.`,
      });
    }
  }
  return { summary, insights };
}
