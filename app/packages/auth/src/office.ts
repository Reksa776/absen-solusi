import { randomUUID } from "node:crypto";

import { withTenant, writeAudit, type TenantContext } from "@absensi/database";

import { reverseGeocodeCoordinates } from "./geocoding.js";
import { resolveGoogleMapsUrl } from "./google-maps.js";
import { HttpError } from "./http.js";
import { assertWorkspaceReadClaim } from "./workspaces.js";

export const OFFICE_NAME_MAX_LENGTH = 120;
export const OFFICE_ADDRESS_MAX_LENGTH = 255;
export const OFFICE_RADIUS_MIN_METERS = 10;
export const OFFICE_RADIUS_MAX_METERS = 5_000;
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

export type OfficeSummary = {
  id: string;
  name: string;
  address: string | null;
  latitude: number;
  longitude: number;
  googleMapsUrl: string | null;
  radiusMeters: number;
  timezone: string;
  workStart: string;
  workEnd: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

export type OfficeInput = Record<string, unknown>;

type OfficeRow = {
  id: string;
  name: string;
  address: string | null;
  latitude: number;
  longitude: number;
  googleMapsUrl: string | null;
  radiusMeters: number;
  timezone: string;
  workStart: string;
  workEnd: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
};

function toSummary(row: OfficeRow): OfficeSummary {
  return {
    id: row.id,
    name: row.name,
    address: row.address,
    latitude: row.latitude,
    longitude: row.longitude,
    googleMapsUrl: row.googleMapsUrl,
    radiusMeters: row.radiusMeters,
    timezone: row.timezone,
    workStart: row.workStart,
    workEnd: row.workEnd,
    isActive: row.isActive,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function assertManage(ctx: TenantContext): void {
  if (!ctx.permissions.includes("office.manage")) {
    throw new HttpError(403, "FORBIDDEN", "Permission tidak mencukupi");
  }
}

function requiredString(value: unknown, field: string, max: number): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new HttpError(400, "INVALID_INPUT", `Field ${field} wajib diisi`);
  }
  const trimmed = value.trim();
  if (trimmed.length > max) {
    throw new HttpError(400, "INVALID_INPUT", `Field ${field} terlalu panjang`);
  }
  return trimmed;
}

function optionalString(value: unknown, max: number): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") {
    throw new HttpError(400, "INVALID_INPUT", "Alamat harus berupa teks");
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  if (trimmed.length > max) {
    throw new HttpError(400, "INVALID_INPUT", "Alamat terlalu panjang");
  }
  return trimmed;
}

function numeric(value: unknown, field: string): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) {
    throw new HttpError(400, "INVALID_INPUT", `Field ${field} harus angka`);
  }
  return parsed;
}

function parseLatitude(value: unknown): number {
  const latitude = numeric(value, "latitude");
  if (latitude < -90 || latitude > 90) {
    throw new HttpError(400, "INVALID_COORDINATE", "Latitude tidak valid");
  }
  return latitude;
}

function parseLongitude(value: unknown): number {
  const longitude = numeric(value, "longitude");
  if (longitude < -180 || longitude > 180) {
    throw new HttpError(400, "INVALID_COORDINATE", "Longitude tidak valid");
  }
  return longitude;
}

function parseRadius(value: unknown): number {
  const radius = numeric(value, "radiusMeters");
  if (
    !Number.isInteger(radius) ||
    radius < OFFICE_RADIUS_MIN_METERS ||
    radius > OFFICE_RADIUS_MAX_METERS
  ) {
    throw new HttpError(
      400,
      "INVALID_RADIUS",
      `Radius harus ${OFFICE_RADIUS_MIN_METERS}-${OFFICE_RADIUS_MAX_METERS} meter`,
    );
  }
  return radius;
}

/** Timezone harus IANA yang dikenal runtime, bukan string bebas. */
export function isValidTimezone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

function parseTimezone(value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new HttpError(400, "INVALID_INPUT", "Timezone wajib diisi");
  }
  const timezone = value.trim();
  if (timezone.length > 64 || !isValidTimezone(timezone)) {
    throw new HttpError(400, "INVALID_TIMEZONE", "Timezone IANA tidak valid");
  }
  return timezone;
}

function parseTime(value: unknown, field: string): string {
  if (typeof value !== "string" || !TIME_PATTERN.test(value.trim())) {
    throw new HttpError(400, "INVALID_TIME", `Field ${field} harus berformat HH:MM`);
  }
  return value.trim();
}

function parseActive(value: unknown, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  if (typeof value !== "boolean") {
    throw new HttpError(400, "INVALID_INPUT", "isActive harus boolean");
  }
  return value;
}

function assertWorkHours(workStart: string, workEnd: string): void {
  const start = Number(workStart.slice(0, 2)) * 60 + Number(workStart.slice(3, 5));
  const end = Number(workEnd.slice(0, 2)) * 60 + Number(workEnd.slice(3, 5));
  if (end <= start) {
    throw new HttpError(400, "INVALID_WORK_HOURS", "Jam pulang harus setelah jam masuk");
  }
}

type NormalizedOffice = {
  name: string;
  address: string | null;
  latitude: number;
  longitude: number;
  googleMapsUrl: string | null;
  radiusMeters: number;
  timezone: string;
  workStart: string;
  workEnd: string;
  isActive: boolean;
};

function mapsUrlValue(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") {
    throw new HttpError(400, "INVALID_GOOGLE_MAPS_URL", "URL Google Maps tidak valid");
  }
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.length > 1024) {
    throw new HttpError(400, "INVALID_GOOGLE_MAPS_URL", "URL Google Maps terlalu panjang");
  }
  return trimmed;
}

async function applyMapsUrl(
  input: OfficeInput,
  currentAddress?: string | null,
): Promise<OfficeInput> {
  if (input.googleMapsUrl === undefined) return input;
  const raw = mapsUrlValue(input.googleMapsUrl);
  if (!raw) return { ...input, googleMapsUrl: null };
  const resolved = await resolveGoogleMapsUrl(raw);
  const addressMissing =
    input.address === undefined
      ? !currentAddress || currentAddress.trim() === ""
      : input.address === null ||
        (typeof input.address === "string" && input.address.trim() === "");
  let address = input.address;
  if (addressMissing) {
    const geocoded = await reverseGeocodeCoordinates(
      resolved.latitude,
      resolved.longitude,
    );
    if (geocoded) address = geocoded.slice(0, OFFICE_ADDRESS_MAX_LENGTH);
  }
  return {
    ...input,
    googleMapsUrl: resolved.googleMapsUrl,
    latitude: resolved.latitude,
    longitude: resolved.longitude,
    address,
  };
}

function normalizeCreate(input: OfficeInput): NormalizedOffice {
  const workStart = parseTime(input.workStart, "workStart");
  const workEnd = parseTime(input.workEnd, "workEnd");
  assertWorkHours(workStart, workEnd);
  return {
    name: requiredString(input.name, "name", OFFICE_NAME_MAX_LENGTH),
    address: optionalString(input.address, OFFICE_ADDRESS_MAX_LENGTH),
    latitude: parseLatitude(input.latitude),
    longitude: parseLongitude(input.longitude),
    googleMapsUrl: mapsUrlValue(input.googleMapsUrl),
    radiusMeters: parseRadius(input.radiusMeters),
    timezone: parseTimezone(input.timezone),
    workStart,
    workEnd,
    isActive: parseActive(input.isActive, true),
  };
}

function normalizeUpdate(input: OfficeInput, existing: NormalizedOffice): NormalizedOffice {
  const workStart =
    input.workStart === undefined ? existing.workStart : parseTime(input.workStart, "workStart");
  const workEnd =
    input.workEnd === undefined ? existing.workEnd : parseTime(input.workEnd, "workEnd");
  assertWorkHours(workStart, workEnd);
  return {
    name:
      input.name === undefined
        ? existing.name
        : requiredString(input.name, "name", OFFICE_NAME_MAX_LENGTH),
    address:
      input.address === undefined
        ? existing.address
        : optionalString(input.address, OFFICE_ADDRESS_MAX_LENGTH),
    latitude: input.latitude === undefined ? existing.latitude : parseLatitude(input.latitude),
    longitude:
      input.longitude === undefined ? existing.longitude : parseLongitude(input.longitude),
    googleMapsUrl:
      input.googleMapsUrl === undefined
        ? existing.googleMapsUrl
        : mapsUrlValue(input.googleMapsUrl),
    radiusMeters:
      input.radiusMeters === undefined ? existing.radiusMeters : parseRadius(input.radiusMeters),
    timezone: input.timezone === undefined ? existing.timezone : parseTimezone(input.timezone),
    workStart,
    workEnd,
    isActive: parseActive(input.isActive, existing.isActive),
  };
}

export async function listOffices(input: {
  ctx: TenantContext;
  workspaceId: string;
}): Promise<OfficeSummary[]> {
  assertManage(input.ctx);
  assertWorkspaceReadClaim(input.ctx, input.workspaceId);
  const rows = await withTenant(input.ctx, (db) =>
    db.officeLocation.findMany({
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    }),
  );
  return rows.map(toSummary);
}

export async function createOffice(input: {
  ctx: TenantContext;
  workspaceId: string;
  office: OfficeInput;
  ip?: string | null;
  userAgent?: string | null;
}): Promise<OfficeSummary> {
  assertManage(input.ctx);
  assertWorkspaceReadClaim(input.ctx, input.workspaceId);
  const values = normalizeCreate(await applyMapsUrl(input.office));
  const id = randomUUID();

  const created = await withTenant(input.ctx, (db) =>
    db.$transaction(async (tx) => {
      // Phase 7: satu workspace boleh memiliki banyak kantor aktif.
      const row = await tx.officeLocation.create({
        data: { id, tenantId: input.ctx.tenantId, ...values },
      });
      await writeAudit(
        {
          tenantId: input.ctx.tenantId,
          actorType: "USER",
          actorUserId: input.ctx.userId,
          actorMemberId: input.ctx.memberId,
          action: "workspace.office_create",
          resourceType: "office_location",
          resourceId: id,
          metadata: {
            name: values.name,
            isActive: values.isActive,
            hasGoogleMapsUrl: values.googleMapsUrl !== null,
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

export async function updateOffice(input: {
  ctx: TenantContext;
  workspaceId: string;
  officeId: string;
  office: OfficeInput;
  ip?: string | null;
  userAgent?: string | null;
}): Promise<OfficeSummary> {
  assertManage(input.ctx);
  assertWorkspaceReadClaim(input.ctx, input.workspaceId);

  const existing = await withTenant(input.ctx, (db) =>
    db.officeLocation.findFirst({ where: { id: input.officeId } }),
  );
  if (!existing) {
    throw new HttpError(404, "OFFICE_NOT_FOUND", "Kantor tidak ditemukan");
  }

  const values = normalizeUpdate(await applyMapsUrl(input.office, existing.address), {
    name: existing.name,
    address: existing.address,
    latitude: existing.latitude,
    longitude: existing.longitude,
    googleMapsUrl: existing.googleMapsUrl,
    radiusMeters: existing.radiusMeters,
    timezone: existing.timezone,
    workStart: existing.workStart,
    workEnd: existing.workEnd,
    isActive: existing.isActive,
  });

  const updated = await withTenant(input.ctx, (db) =>
    db.$transaction(async (tx) => {
      const row = await tx.officeLocation.update({
        where: { tenantId_id: { tenantId: input.ctx.tenantId, id: existing.id } },
        data: values,
      });
      await writeAudit(
        {
          tenantId: input.ctx.tenantId,
          actorType: "USER",
          actorUserId: input.ctx.userId,
          actorMemberId: input.ctx.memberId,
          action: "workspace.office_update",
          resourceType: "office_location",
          resourceId: existing.id,
          metadata: {
            name: values.name,
            isActive: values.isActive,
            hasGoogleMapsUrl: values.googleMapsUrl !== null,
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
}
