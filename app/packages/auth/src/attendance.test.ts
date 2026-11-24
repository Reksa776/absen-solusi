import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after, before } from "node:test";

import {
  createTenantContext,
  resolveMemberPermissions,
  type PrismaClient,
  type TenantContext,
} from "@absensi/database";

import {
  ACCURACY_THRESHOLD_METERS,
  listMyAttendance,
  listWorkspaceAttendance,
  recordAttendance,
} from "./attendance.js";
import { HttpError } from "./http.js";
import { lateMinutesForWorkPattern } from "./work-pattern-schedule.js";
import { adminClient, resetDatabase, seedMember, seedTenant } from "./test-support.js";

let db: PrismaClient = null as unknown as PrismaClient;
let photoDir = "";
const OFFICE = { latitude: -6.2, longitude: 106.8, radiusMeters: 100 };

before(async () => {
  db = adminClient();
  await resetDatabase(db);
  photoDir = await mkdtemp(join(tmpdir(), "absensi-attendance-"));
  process.env.ATTENDANCE_PHOTO_DIR = photoDir;
});

after(async () => {
  if (!db) return;
  await resetDatabase(db);
  await db.$disconnect();
  delete process.env.ATTENDANCE_PHOTO_DIR;
  await rm(photoDir, { recursive: true, force: true });
});

async function ctxFor(tenantId: string, userId: string, memberId: string): Promise<TenantContext> {
  const perms = await resolveMemberPermissions(db, tenantId, memberId);
  return createTenantContext({ tenantId, userId, memberId, ...perms });
}

async function tenantWithOffice(name = "Attendance") {
  const tenant = await seedTenant(db, { name });
  const officeId = randomUUID();
  await db.officeLocation.create({
    data: {
      id: officeId,
      tenantId: tenant.tenantId,
      name: "HQ",
      ...OFFICE,
      timezone: "Asia/Jakarta",
      workStart: "09:00",
      workEnd: "17:00",
    },
  });
  const ctx = await ctxFor(tenant.tenantId, tenant.ownerUserId, tenant.ownerMemberId);
  return { ...tenant, officeId, ctx };
}

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 0xff, 0xd9]);

async function record(
  ctx: TenantContext,
  overrides: Partial<Parameters<typeof recordAttendance>[0]> = {},
) {
  return recordAttendance({
    ctx,
    type: "CHECK_IN",
    latitude: OFFICE.latitude,
    longitude: OFFICE.longitude,
    accuracyMeters: 5,
    isMockLocation: false,
    deviceInfo: "test-device",
    photo: { bytes: JPEG, filename: "selfie.jpg", contentType: "image/jpeg" },
    ip: "203.0.113.55",
    userAgent: "attendance-test",
    ...overrides,
  });
}

async function rejectsWith(
  work: () => Promise<unknown>,
  status: number,
  code: string,
): Promise<void> {
  await assert.rejects(work, (error: unknown) => {
    assert.ok(error instanceof HttpError, `bukan HttpError: ${String(error)}`);
    assert.equal(error.status, status);
    assert.equal(error.code, code);
    return true;
  });
}

test("A1: check-in dalam radius menulis attendance, foto filesystem, dan audit aman", async () => {
  const tenant = await tenantWithOffice();
  const result = await record(tenant.ctx);

  const row = await db.attendanceLog.findUniqueOrThrow({ where: { id: result.id } });
  assert.equal(row.tenantId, tenant.tenantId);
  assert.equal(row.memberId, tenant.ownerMemberId);
  assert.equal(row.type, "CHECK_IN");
  assert.equal(row.isMockLocation, false);
  assert.equal(row.isSuspicious, false);
  assert.equal(row.photoHash, createHash("sha256").update(JPEG).digest("hex"));
  assert.match(row.photoUrl, /^\/api\/attendance\/[0-9a-f-]+\/photo$/);
  assert.equal("photo" in row, false);
  assert.equal("base64" in row, false);
  const stored = await readFile(join(photoDir, row.id));
  assert.deepEqual(new Uint8Array(stored), JPEG);

  const audit = await db.auditLog.findFirstOrThrow({
    where: { action: "attendance.check_in", resourceId: result.id },
  });
  assert.equal(audit.tenantId, tenant.tenantId);
  assert.equal(audit.actorUserId, tenant.ownerUserId);
  assert.equal(audit.actorMemberId, tenant.ownerMemberId);
  assert.equal(audit.ipHash?.length, 32);
  assert.deepEqual(Object.keys(audit.metadata as object).sort(), [
    "accuracy_meters",
    "attendance_status",
    "distance_meters",
    "early_leave_minutes",
    "late_minutes",
    "office_id",
    "offline_synced",
    "suspicious_reasons",
    "wfh_request_id",
    "work_mode",
    "work_pattern_id",
  ]);
  const serialized = JSON.stringify(audit.metadata);
  assert.equal(serialized.includes(String(OFFICE.latitude)), false);
  assert.equal(serialized.includes(String(OFFICE.longitude)), false);
  assert.equal(serialized.includes(row.photoHash), false);
  assert.equal(serialized.includes("photo"), false);
});

test("A2: di luar radius 403 GEOFENCE_VIOLATION, tanpa baris dan tanpa file tertinggal", async () => {
  const tenant = await tenantWithOffice();
  const filesBefore = await readdir(photoDir);
  await rejectsWith(
    () => record(tenant.ctx, { latitude: -6.3, longitude: 106.9 }),
    403,
    "GEOFENCE_VIOLATION",
  );
  assert.equal(await db.attendanceLog.count({ where: { tenantId: tenant.tenantId } }), 0);
  assert.deepEqual(await readdir(photoDir), filesBefore);
});

test("A3: accuracy di atas threshold 400 ACCURACY_TOO_LOW", async () => {
  const tenant = await tenantWithOffice();
  await rejectsWith(
    () => record(tenant.ctx, { accuracyMeters: ACCURACY_THRESHOLD_METERS + 0.1 }),
    400,
    "ACCURACY_TOO_LOW",
  );
  assert.equal(await db.attendanceLog.count({ where: { tenantId: tenant.tenantId } }), 0);
});

test("A4: mock location 403 MOCK_LOCATION_DETECTED", async () => {
  const tenant = await tenantWithOffice();
  await rejectsWith(
    () => record(tenant.ctx, { isMockLocation: true }),
    403,
    "MOCK_LOCATION_DETECTED",
  );
  assert.equal(await db.attendanceLog.count({ where: { tenantId: tenant.tenantId } }), 0);
});

test("A5: check-in ganda hari sama 409 ALREADY_CHECKED_IN dan hanya satu baris", async () => {
  const tenant = await tenantWithOffice();
  await record(tenant.ctx);
  await rejectsWith(() => record(tenant.ctx), 409, "ALREADY_CHECKED_IN");
  assert.equal(await db.attendanceLog.count({ where: { tenantId: tenant.tenantId } }), 1);
});

test("A6: check-out setelah check-in berhasil dan menulis audit attendance.check_out", async () => {
  const tenant = await tenantWithOffice();
  const checkIn = await record(tenant.ctx);
  const checkOut = await record(tenant.ctx, {
    type: "CHECK_OUT",
    now: new Date(Date.now() + 8 * 3600_000),
    accuracyMeters: 7,
  });
  const rows = await db.attendanceLog.findMany({ where: { tenantId: tenant.tenantId } });
  assert.deepEqual(rows.map((row) => row.type).sort(), ["CHECK_IN", "CHECK_OUT"]);
  const audit = await db.auditLog.findFirst({
    where: { action: "attendance.check_out", resourceId: checkOut.id },
  });
  assert.ok(audit);
  assert.notEqual(checkIn.id, checkOut.id);
});

test("A7: riwayat pribadi hanya baris sendiri; admin tenant lain 403 identik", async () => {
  const a = await tenantWithOffice("History A");
  const b = await tenantWithOffice("History B");
  const memberA = await seedMember(db, a.tenantId, a.roles.VIEWER);
  const memberB = await seedMember(db, b.tenantId, b.roles.VIEWER);
  const ctxMemberA = await ctxFor(a.tenantId, memberA.userId, memberA.memberId);

  const own = await record(ctxMemberA);
  await record(b.ctx);

  const mine = await listMyAttendance({ ctx: ctxMemberA });
  assert.deepEqual(mine.map((row) => row.id), [own.id]);
  assert.equal(mine.some((row) => row.tenantId === b.tenantId), false);

  const adminRows = await listWorkspaceAttendance({
    ctx: a.ctx,
    workspaceId: a.tenantId,
  });
  assert.deepEqual(adminRows.map((row) => row.id), [own.id]);

  async function capture(workspaceId: string) {
    try {
      await listWorkspaceAttendance({ ctx: a.ctx, workspaceId });
      throw new Error("harus gagal");
    } catch (error) {
      assert.ok(error instanceof HttpError);
      return { status: error.status, code: error.code, message: error.message };
    }
  }
  const foreign = await capture(b.tenantId);
  const missing = await capture("00000000-0000-4000-8000-000000000000");
  assert.deepEqual(foreign, missing);
  assert.equal(foreign.status, 403);
  assert.equal(foreign.code, "WORKSPACE_NOT_FOUND");
});

test("A8: kecepatan tidak wajar menandai is_suspicious dan alasan audit", async () => {
  const tenant = await tenantWithOffice();
  await db.attendanceLog.create({
    data: {
      id: randomUUID(),
      tenantId: tenant.tenantId,
      memberId: tenant.ownerMemberId,
      workDate: new Date("2025-12-31T00:00:00Z"),
      type: "CHECK_IN",
      timestampServer: new Date("2025-12-31T23:50:00Z"),
      latitude: -7.8,
      longitude: 110.4,
      accuracyMeters: 5,
      distanceMeters: 0,
      isMockLocation: false,
      photoUrl: "/uploads/attendance/old.jpg",
      photoHash: "a".repeat(64),
    },
  });
  const result = await record(tenant.ctx, {
    now: new Date("2026-01-01T00:10:00Z"),
  });
  assert.equal(result.isSuspicious, true);
  const audit = await db.auditLog.findFirstOrThrow({
    where: { action: "attendance.check_in", resourceId: result.id },
  });
  assert.deepEqual(
    (audit.metadata as { suspicious_reasons: string[] }).suspicious_reasons,
    ["unrealistic_speed"],
  );
});

test("A10: Pola Kerja overnight mengaitkan check-out pagi H+1 ke workDate H", async () => {
  const tenant = await tenantWithOffice("Overnight");
  const patternId = randomUUID();
  await db.workPattern.create({
    data: {
      id: patternId,
      tenantId: tenant.tenantId,
      name: "Malam",
      timezone: "Asia/Jakarta",
      days: {
        create: [
          {
            id: randomUUID(),
            dayOfWeek: 5,
            isWorkday: true,
            startTime: "22:00",
            endTime: "06:00",
            earliestCheckInMinutes: 120,
            lateToleranceMinutes: 15,
          },
        ],
      },
    },
  });
  await db.workPatternAssignment.create({
    data: {
      id: randomUUID(),
      tenantId: tenant.tenantId,
      memberId: tenant.ownerMemberId,
      workPatternId: patternId,
    },
  });

  const checkIn = await record(tenant.ctx, {
    now: new Date("2026-11-20T15:10:00.000Z"),
  });
  const checkOut = await record(tenant.ctx, {
    type: "CHECK_OUT",
    now: new Date("2026-11-20T23:05:00.000Z"),
  });
  assert.equal(checkIn.workDate, "2026-11-20");
  assert.equal(checkOut.workDate, "2026-11-20");
  const rows = await db.attendanceLog.findMany({
    where: { tenantId: tenant.tenantId },
    orderBy: { timestampServer: "asc" },
  });
  assert.deepEqual(rows.map((row) => row.workDate.toISOString().slice(0, 10)), [
    "2026-11-20",
    "2026-11-20",
  ]);

  const rule = { startTime: "22:00", endTime: "06:00", lateToleranceMinutes: 15 };
  assert.equal(
    lateMinutesForWorkPattern(new Date("2026-11-20T15:30:00.000Z"), rule, "Asia/Jakarta"),
    15,
  );
  assert.equal(
    lateMinutesForWorkPattern(new Date("2026-11-20T17:30:00.000Z"), rule, "Asia/Jakarta"),
    135,
  );
});

test("A9: koordinat identik berulang menandai suspicious; accuracy normal tidak", async () => {
  const repeated = await tenantWithOffice("Repeated");
  await db.attendanceLog.create({
    data: {
      id: randomUUID(),
      tenantId: repeated.tenantId,
      memberId: repeated.ownerMemberId,
      workDate: new Date("2026-01-01T00:00:00Z"),
      type: "CHECK_IN",
      timestampServer: new Date("2026-01-01T00:00:00Z"),
      latitude: OFFICE.latitude,
      longitude: OFFICE.longitude,
      accuracyMeters: 5,
      distanceMeters: 0,
      isMockLocation: false,
      photoUrl: "/uploads/attendance/old.jpg",
      photoHash: "b".repeat(64),
    },
  });
  const duplicated = await record(repeated.ctx, { now: new Date("2026-01-02T00:10:00Z") });
  assert.equal(duplicated.isSuspicious, true);

  const normal = await tenantWithOffice("Normal");
  const result = await record(normal.ctx);
  assert.equal(result.isSuspicious, false);
});
