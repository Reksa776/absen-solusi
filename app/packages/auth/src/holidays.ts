import { randomUUID } from "node:crypto";

import { withTenant, writeAudit, type TenantContext } from "@absensi/database";

import { HttpError } from "./http.js";
import { nationalHolidaysForYear } from "./national-holidays.js";
import { parseReportDay } from "./reports.js";
import { assertWorkspaceReadClaim } from "./workspaces.js";

export const HOLIDAY_NAME_MAX_LENGTH = 120;

export type HolidaySummary = {
  id: string;
  date: string;
  name: string;
  createdAt: string;
};

function dayString(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function assertManage(ctx: TenantContext): void {
  if (!ctx.permissions.includes("workspace.manage")) {
    throw new HttpError(403, "FORBIDDEN", "Permission tidak mencukupi");
  }
}

function isUniqueError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "P2002"
  );
}

function toSummary(row: {
  id: string;
  date: Date;
  name: string;
  createdAt: Date;
}): HolidaySummary {
  return {
    id: row.id,
    date: dayString(row.date),
    name: row.name,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function listHolidays(input: {
  ctx: TenantContext;
  workspaceId: string;
  year?: string | number | undefined;
}): Promise<HolidaySummary[]> {
  assertWorkspaceReadClaim(input.ctx, input.workspaceId);
  const rawYear = input.year;
  const year =
    rawYear === undefined || `${rawYear}`.trim() === "" ? undefined : Number(rawYear);
  if (year !== undefined && (!Number.isInteger(year) || year < 2000 || year > 2100)) {
    throw new HttpError(400, "INVALID_YEAR", "Parameter year tidak valid");
  }
  const where = year
    ? {
        date: {
          gte: new Date(Date.UTC(year, 0, 1)),
          lt: new Date(Date.UTC(year + 1, 0, 1)),
        },
      }
    : {};
  const rows = await withTenant(input.ctx, (db) =>
    db.workspaceHoliday.findMany({
      where,
      orderBy: [{ date: "asc" }, { id: "asc" }],
    }),
  );
  return rows.map(toSummary);
}

export type CreateHolidayInput = {
  ctx: TenantContext;
  workspaceId: string;
  date: string;
  name: string;
  ip?: string | null;
  userAgent?: string | null;
};

export async function createHoliday(input: CreateHolidayInput): Promise<HolidaySummary> {
  assertManage(input.ctx);
  assertWorkspaceReadClaim(input.ctx, input.workspaceId);
  const date = parseReportDay(input.date, "date");
  const name = input.name.trim();
  if (name.length === 0) {
    throw new HttpError(400, "INVALID_NAME", "Nama hari libur wajib diisi");
  }
  if (name.length > HOLIDAY_NAME_MAX_LENGTH) {
    throw new HttpError(400, "INVALID_NAME", "Nama hari libur terlalu panjang");
  }

  const id = randomUUID();
  try {
    const created = await withTenant(input.ctx, (db) =>
      db.$transaction(async (tx) => {
        const row = await tx.workspaceHoliday.create({
          data: { id, tenantId: input.ctx.tenantId, date, name },
        });
        await writeAudit(
          {
            tenantId: input.ctx.tenantId,
            actorType: "USER",
            actorUserId: input.ctx.userId,
            actorMemberId: input.ctx.memberId,
            action: "workspace.holiday_create",
            resourceType: "workspace_holiday",
            resourceId: id,
            metadata: { date: dayString(date), name },
            ip: input.ip ?? null,
            userAgent: input.userAgent ?? null,
          },
          tx,
        );
        return row;
      }),
    );
    return toSummary(created);
  } catch (error) {
    if (isUniqueError(error)) {
      throw new HttpError(409, "HOLIDAY_EXISTS", "Tanggal tersebut sudah menjadi hari libur");
    }
    throw error;
  }
}

export async function updateHoliday(input: {
  ctx: TenantContext;
  workspaceId: string;
  holidayId: string;
  date?: string | undefined;
  name?: string | undefined;
  ip?: string | null;
  userAgent?: string | null;
}): Promise<HolidaySummary> {
  assertManage(input.ctx);
  assertWorkspaceReadClaim(input.ctx, input.workspaceId);
  if (input.date === undefined && input.name === undefined) {
    throw new HttpError(400, "INVALID_HOLIDAY", "Tidak ada perubahan hari libur");
  }
  const existing = await withTenant(input.ctx, (db) =>
    db.workspaceHoliday.findFirst({ where: { id: input.holidayId } }),
  );
  if (!existing) {
    throw new HttpError(404, "HOLIDAY_NOT_FOUND", "Hari libur tidak ditemukan");
  }
  const date =
    input.date === undefined ? existing.date : parseReportDay(input.date, "date");
  const name = input.name === undefined ? existing.name : input.name.trim();
  if (name.length === 0) {
    throw new HttpError(400, "INVALID_NAME", "Nama hari libur wajib diisi");
  }
  if (name.length > HOLIDAY_NAME_MAX_LENGTH) {
    throw new HttpError(400, "INVALID_NAME", "Nama hari libur terlalu panjang");
  }

  try {
    const updated = await withTenant(input.ctx, (db) =>
      db.$transaction(async (tx) => {
        const row = await tx.workspaceHoliday.update({
          where: {
            tenantId_id: { tenantId: input.ctx.tenantId, id: existing.id },
          },
          data: { date, name },
        });
        await writeAudit(
          {
            tenantId: input.ctx.tenantId,
            actorType: "USER",
            actorUserId: input.ctx.userId,
            actorMemberId: input.ctx.memberId,
            action: "workspace.holiday_update",
            resourceType: "workspace_holiday",
            resourceId: row.id,
            metadata: {
              from: { date: dayString(existing.date), name: existing.name },
              to: { date: dayString(row.date), name: row.name },
            },
            ip: input.ip ?? null,
            userAgent: input.userAgent ?? null,
          },
          tx,
        );
        return row;
      }),
    );
    return toSummary(updated);
  } catch (error) {
    if (isUniqueError(error)) {
      throw new HttpError(409, "HOLIDAY_EXISTS", "Tanggal tersebut sudah menjadi hari libur");
    }
    throw error;
  }
}

export type NationalHolidayImport = {
  year: number;
  created: number;
  skipped: number;
  holidays: HolidaySummary[];
};

export async function importNationalHolidays(input: {
  ctx: TenantContext;
  workspaceId: string;
  year: string | number;
  ip?: string | null;
  userAgent?: string | null;
}): Promise<NationalHolidayImport> {
  assertManage(input.ctx);
  assertWorkspaceReadClaim(input.ctx, input.workspaceId);
  const year = Number(input.year);
  if (!Number.isInteger(year) || year < 2000 || year > 2100) {
    throw new HttpError(400, "INVALID_YEAR", "Parameter year tidak valid");
  }
  const national = nationalHolidaysForYear(year);
  if (!national) {
    throw new HttpError(
      400,
      "NATIONAL_HOLIDAYS_UNAVAILABLE",
      `Data hari libur nasional ${year} belum tersedia`,
    );
  }

  const result = await withTenant(input.ctx, (db) =>
    db.$transaction(async (tx) => {
      const existing = await tx.workspaceHoliday.findMany({
        where: {
          date: {
            gte: new Date(Date.UTC(year, 0, 1)),
            lt: new Date(Date.UTC(year + 1, 0, 1)),
          },
        },
        select: { date: true },
      });
      const known = new Set(existing.map((row) => dayString(row.date)));
      let created = 0;
      for (const entry of national) {
        if (known.has(entry.date)) continue;
        await tx.workspaceHoliday.create({
          data: {
            id: randomUUID(),
            tenantId: input.ctx.tenantId,
            date: new Date(`${entry.date}T00:00:00.000Z`),
            name: entry.name,
          },
        });
        known.add(entry.date);
        created += 1;
      }
      await writeAudit(
        {
          tenantId: input.ctx.tenantId,
          actorType: "USER",
          actorUserId: input.ctx.userId,
          actorMemberId: input.ctx.memberId,
          action: "workspace.holiday_import_national",
          resourceType: "workspace_holiday",
          resourceId: `${year}`,
          metadata: {
            year,
            created,
            skipped: national.length - created,
          },
          ip: input.ip ?? null,
          userAgent: input.userAgent ?? null,
        },
        tx,
      );
      return { created, skipped: national.length - created };
    }),
  );
  return {
    year,
    created: result.created,
    skipped: result.skipped,
    holidays: await listHolidays({
      ctx: input.ctx,
      workspaceId: input.workspaceId,
      year,
    }),
  };
}

export async function deleteHoliday(input: {
  ctx: TenantContext;
  workspaceId: string;
  holidayId: string;
  ip?: string | null;
  userAgent?: string | null;
}): Promise<HolidaySummary> {
  assertManage(input.ctx);
  assertWorkspaceReadClaim(input.ctx, input.workspaceId);
  const existing = await withTenant(input.ctx, (db) =>
    db.workspaceHoliday.findFirst({ where: { id: input.holidayId } }),
  );
  if (!existing) {
    throw new HttpError(404, "HOLIDAY_NOT_FOUND", "Hari libur tidak ditemukan");
  }

  await withTenant(input.ctx, (db) =>
    db.$transaction(async (tx) => {
      await tx.workspaceHoliday.delete({
        where: {
          tenantId_id: { tenantId: input.ctx.tenantId, id: existing.id },
        },
      });
      await writeAudit(
        {
          tenantId: input.ctx.tenantId,
          actorType: "USER",
          actorUserId: input.ctx.userId,
          actorMemberId: input.ctx.memberId,
          action: "workspace.holiday_delete",
          resourceType: "workspace_holiday",
          resourceId: existing.id,
          metadata: { date: dayString(existing.date), name: existing.name },
          ip: input.ip ?? null,
          userAgent: input.userAgent ?? null,
        },
        tx,
      );
    }),
  );
  return toSummary(existing);
}
