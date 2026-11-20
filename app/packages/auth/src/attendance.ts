import { createHash, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { withTenant, writeAudit, type TenantContext } from "@absensi/database";

import { HttpError } from "./http.js";
import { isOvernightShift, shiftMinutes } from "./shifts.js";

export const ACCURACY_THRESHOLD_METERS = 100;
export const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
export const MAX_SPEED_KMH = 200;
/** Foto hanya disajikan lewat endpoint ber-otorisasi, bukan direktori publik. */
export const ATTENDANCE_PHOTO_URL_PREFIX = "/api/attendance/";

export function haversineMeters(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const radius = 6_371_000;
  const rad = (value: number) => (value * Math.PI) / 180;
  const dLat = rad(lat2 - lat1);
  const dLon = rad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * radius * Math.asin(Math.sqrt(a));
}

export type AttendancePhoto = { bytes: Uint8Array; filename: string; contentType: string };
export type AttendanceType = "CHECK_IN" | "CHECK_OUT";

export type RecordAttendanceInput = {
  ctx: TenantContext;
  type: AttendanceType;
  latitude: number;
  longitude: number;
  accuracyMeters: number;
  isMockLocation: boolean;
  deviceInfo?: string | null;
  photo: AttendancePhoto;
  ip?: string | null;
  userAgent?: string | null;
  idempotencyKey?: string | null;
  now?: Date;
};

export type AttendanceResult = {
  id: string;
  type: AttendanceType;
  timestampServer: string;
  distanceMeters: number;
  accuracyMeters: number;
  isSuspicious: boolean;
  photoUrl: string;
  workMode?: "OFFICE" | "WFH";
  workDate?: string;
};

function assertCoordinate(value: number, label: string, min: number, max: number): void {
  if (!Number.isFinite(value) || value < min || value > max) {
    throw new HttpError(400, "INVALID_COORDINATE", `${label} tidak valid`);
  }
}

async function storePhoto(
  input: AttendancePhoto,
  attendanceId: string,
): Promise<{ url: string; hash: string; path: string }> {
  if (input.bytes.byteLength === 0 || input.bytes.byteLength > MAX_PHOTO_BYTES) {
    throw new HttpError(400, "INVALID_PHOTO", "Foto wajib dan maksimal 5 MB");
  }
  if (!/^image\/(jpeg|png|webp)$/.test(input.contentType)) {
    throw new HttpError(400, "INVALID_PHOTO", "Foto harus JPEG, PNG, atau WebP");
  }
  const dir = process.env.ATTENDANCE_PHOTO_DIR ?? join(process.cwd(), "storage", "attendance");
  await mkdir(dir, { recursive: true });
  // Nama file = id absensi; tipe konten dideteksi dari magic bytes saat dibaca.
  const path = join(dir, attendanceId);
  await writeFile(path, input.bytes);
  return {
    url: `${ATTENDANCE_PHOTO_URL_PREFIX}${attendanceId}/photo`,
    hash: createHash("sha256").update(input.bytes).digest("hex"),
    path,
  };
}

export async function recordAttendance(input: RecordAttendanceInput): Promise<AttendanceResult> {
  assertCoordinate(input.latitude, "latitude", -90, 90);
  assertCoordinate(input.longitude, "longitude", -180, 180);
  if (!Number.isFinite(input.accuracyMeters) || input.accuracyMeters <= 0) {
    throw new HttpError(400, "INVALID_ACCURACY", "accuracy_meters tidak valid");
  }
  if (input.isMockLocation) {
    throw new HttpError(403, "MOCK_LOCATION_DETECTED", "Mock location terdeteksi");
  }
  if (input.accuracyMeters > ACCURACY_THRESHOLD_METERS) {
    throw new HttpError(400, "ACCURACY_TOO_LOW", "Akurasi GPS terlalu rendah");
  }

  const now = input.now ?? new Date();
  const attendanceId = randomUUID();
  const stored = await storePhoto(input.photo, attendanceId);
  let committed = false;
  try {
    return await withTenant(input.ctx, async (db) => {
      if (input.idempotencyKey) {
        const replay = await db.attendanceLog.findFirst({
          where: { memberId: input.ctx.memberId, idempotencyKey: input.idempotencyKey },
        });
        if (replay) {
          if (replay.type !== input.type) {
            throw new HttpError(
              409,
              "IDEMPOTENCY_CONFLICT",
              "Idempotency-Key sudah dipakai untuk tipe absensi lain",
            );
          }
          return {
            id: replay.id,
            type: replay.type as AttendanceType,
            timestampServer: replay.timestampServer.toISOString(),
            distanceMeters: replay.distanceMeters,
            accuracyMeters: replay.accuracyMeters,
            isSuspicious: replay.isSuspicious,
            photoUrl: replay.photoUrl,
            workMode: replay.workMode as "OFFICE" | "WFH",
            workDate: replay.workDate.toISOString().slice(0, 10),
          };
        }
      }
      const member = await db.workspaceMember.findFirst({
        where: { id: input.ctx.memberId },
        select: { officeLocationId: true },
      });
      const offices = await db.officeLocation.findMany({
        where: { isActive: true },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      });
      const timezone = offices[0]?.timezone ?? "UTC";
      const localMinutes = zonedMinutesOfDay(now, timezone);
      const today = utcDay(now);
      const yesterday = new Date(today.getTime() - 86_400_000);
      const shiftRows = await db.memberShift.findMany({
        where: {
          memberId: input.ctx.memberId,
          OR: [{ workDate: null }, { workDate: { in: [today, yesterday] } }],
        },
        include: {
          shift: {
            select: { startTime: true, endTime: true },
          },
        },
      });
      const byDate = new Map<string, { startTime: string; endTime: string }>();
      let defaultShift: { startTime: string; endTime: string } | null = null;
      for (const row of shiftRows) {
        if (row.workDate) {
          byDate.set(row.workDate.toISOString().slice(0, 10), row.shift);
        } else {
          defaultShift = row.shift;
        }
      }
      const shiftForDate = (date: Date) =>
        byDate.get(date.toISOString().slice(0, 10)) ?? defaultShift;
      const yesterdayShift = shiftForDate(yesterday);
      // Check-out pagi H+1 tetap milik sesi shift yang dimulai H.
      const workDate =
        yesterdayShift &&
        isOvernightShift(yesterdayShift.startTime, yesterdayShift.endTime) &&
        localMinutes < shiftMinutes(yesterdayShift.endTime)
          ? yesterday
          : today;

      const wfh = await db.wfhRequest.findFirst({
        where: { memberId: input.ctx.memberId, date: workDate, status: "APPROVED" },
        select: { id: true },
      });
      let office: { id: string; latitude: number; longitude: number; radiusMeters: number } | null =
        null;
      let distance = 0;
      const workMode: "OFFICE" | "WFH" = wfh ? "WFH" : "OFFICE";
      if (!wfh) {
        if (offices.length === 0) {
          throw new HttpError(409, "OFFICE_NOT_CONFIGURED", "Lokasi kantor belum aktif");
        }

        if (member?.officeLocationId) {
          office = offices.find((row) => row.id === member.officeLocationId) ?? null;
          if (!office) {
            throw new HttpError(
              403,
              "OFFICE_ASSIGNMENT_INACTIVE",
              "Kantor yang ditugaskan tidak aktif",
            );
          }
          distance = haversineMeters(
            input.latitude,
            input.longitude,
            office.latitude,
            office.longitude,
          );
          if (distance > office.radiusMeters) {
            throw new HttpError(403, "GEOFENCE_VIOLATION", "Anda berada di luar radius kantor");
          }
        } else {
          // Tanpa penugasan: pilih titik aktif terdekat yang berada dalam radius.
          let best: { office: (typeof offices)[number]; distance: number } | null = null;
          for (const candidate of offices) {
            const candidateDistance = haversineMeters(
              input.latitude,
              input.longitude,
              candidate.latitude,
              candidate.longitude,
            );
            if (
              candidateDistance <= candidate.radiusMeters &&
              (!best || candidateDistance < best.distance)
            ) {
              best = { office: candidate, distance: candidateDistance };
            }
          }
          if (!best) {
            throw new HttpError(403, "GEOFENCE_VIOLATION", "Anda berada di luar radius kantor");
          }
          office = best.office;
          distance = best.distance;
        }
      }

      const previous = await db.attendanceLog.findFirst({
        where: { memberId: input.ctx.memberId },
        orderBy: { timestampServer: "desc" },
      });
      const suspiciousReasons: string[] = [];
      if (input.accuracyMeters < 1) suspiciousReasons.push("accuracy_too_perfect");
      if (previous) {
        const elapsedHours = (now.getTime() - previous.timestampServer.getTime()) / 3_600_000;
        if (elapsedHours > 0) {
          const speed = haversineMeters(
            previous.latitude,
            previous.longitude,
            input.latitude,
            input.longitude,
          ) / 1000 / elapsedHours;
          if (speed > MAX_SPEED_KMH) suspiciousReasons.push("unrealistic_speed");
        }
        if (previous.latitude === input.latitude && previous.longitude === input.longitude) {
          suspiciousReasons.push("identical_coordinates");
        }
      }

      if (input.type === "CHECK_OUT") {
        const checkIn = await db.attendanceLog.findFirst({
          where: { memberId: input.ctx.memberId, workDate, type: "CHECK_IN" },
        });
        if (!checkIn) {
          throw new HttpError(409, "NOT_CHECKED_IN", "Belum check-in untuk sesi ini");
        }
      }

      try {
        const created = await db.attendanceLog.create({
          data: {
            id: attendanceId,
            tenantId: input.ctx.tenantId,
            memberId: input.ctx.memberId,
            workDate,
            type: input.type,
            timestampServer: now,
            latitude: input.latitude,
            longitude: input.longitude,
            accuracyMeters: input.accuracyMeters,
            distanceMeters: distance,
            officeLocationId: office?.id ?? null,
            workMode,
            isMockLocation: false,
            isSuspicious: suspiciousReasons.length > 0,
            photoUrl: stored.url,
            photoHash: stored.hash,
            idempotencyKey: input.idempotencyKey ?? null,
            deviceInfo: input.deviceInfo?.slice(0, 255) ?? null,
            userAgent: input.userAgent?.slice(0, 255) ?? null,
          },
        });
        await writeAudit(
          {
            tenantId: input.ctx.tenantId,
            actorType: "USER",
            actorUserId: input.ctx.userId,
            actorMemberId: input.ctx.memberId,
            action: input.type === "CHECK_IN" ? "attendance.check_in" : "attendance.check_out",
            resourceType: "attendance",
            resourceId: created.id,
            metadata: {
              distance_meters: distance,
              accuracy_meters: input.accuracyMeters,
              office_id: office?.id ?? null,
              work_mode: workMode,
              wfh_request_id: wfh?.id ?? null,
              suspicious_reasons: suspiciousReasons,
              offline_synced: Boolean(input.idempotencyKey),
            },
            ip: input.ip ?? null,
            userAgent: input.userAgent ?? null,
          },
          db as never,
        );
        committed = true;
        return {
          id: created.id,
          type: input.type,
          timestampServer: now.toISOString(),
          distanceMeters: distance,
          accuracyMeters: input.accuracyMeters,
          isSuspicious: suspiciousReasons.length > 0,
          photoUrl: stored.url,
          workMode,
          workDate: workDate.toISOString().slice(0, 10),
        };
      } catch (error) {
        if (typeof error === "object" && error !== null && "code" in error) {
          if ((error as { code?: unknown }).code === "P2002") {
            throw new HttpError(
              409,
              input.type === "CHECK_IN" ? "ALREADY_CHECKED_IN" : "ALREADY_CHECKED_OUT",
              "Absensi hari ini sudah tercatat",
            );
          }
        }
        throw error;
      }
    });
  } finally {
    if (!committed) {
      const { unlink } = await import("node:fs/promises");
      await unlink(stored.path).catch(() => undefined);
    }
  }
}

function utcDay(value: Date): Date {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
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

export async function listActiveOffices(ctx: TenantContext) {
  return withTenant(ctx, (db) =>
    db.officeLocation.findMany({
      where: { isActive: true },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: {
        id: true,
        name: true,
        address: true,
        latitude: true,
        longitude: true,
        radiusMeters: true,
        timezone: true,
        workStart: true,
        workEnd: true,
        isActive: true,
      },
    }),
  );
}

/** Kompatibilitas: kantor pertama; klien multi-lokasi memakai listActiveOffices. */
export async function getActiveOffice(ctx: TenantContext) {
  return (await listActiveOffices(ctx))[0] ?? null;
}

export async function listMyAttendance(input: {
  ctx: TenantContext;
  from?: string | undefined;
  to?: string | undefined;
}) {
  return withTenant(input.ctx, (db) =>
    db.attendanceLog.findMany({
      where: {
        memberId: input.ctx.memberId,
        ...(input.from || input.to
          ? {
              workDate: {
                ...(input.from ? { gte: new Date(`${input.from}T00:00:00Z`) } : {}),
                ...(input.to ? { lte: new Date(`${input.to}T00:00:00Z`) } : {}),
              },
            }
          : {}),
      },
      orderBy: { timestampServer: "desc" },
    }),
  );
}

export async function listWorkspaceAttendance(input: {
  ctx: TenantContext;
  workspaceId: string;
  date?: string | undefined;
  memberId?: string | undefined;
}) {
  if (input.workspaceId !== input.ctx.tenantId) {
    throw new HttpError(403, "WORKSPACE_NOT_FOUND", "Workspace tidak ditemukan");
  }
  return withTenant(input.ctx, (db) =>
    db.attendanceLog.findMany({
      where: {
        ...(input.memberId ? { memberId: input.memberId } : {}),
        ...(input.date
          ? { workDate: new Date(`${input.date}T00:00:00Z`) }
          : {}),
      },
      orderBy: { timestampServer: "desc" },
    }),
  );
}
