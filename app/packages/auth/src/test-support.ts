import { randomUUID } from "node:crypto";

import {
  createDefaultRolesForWorkspace,
  createPrismaClient,
  type PrismaClient,
} from "@absensi/database";
import { ROLE_KEYS, type RoleKey } from "@absensi/permissions";

import { createSession } from "./session.js";

const FORBIDDEN_DATABASE_NAMES = new Set([
  "absensi",
  "absensi_dev",
  "absensi_prod",
  "absensi_production",
  "mysql",
  "information_schema",
  "performance_schema",
  "sys",
]);

/**
 * Fail-closed: test destruktif hanya boleh berjalan pada database verifikasi
 * yang dibuat khusus. Semua nilai harus datang dari environment eksplisit;
 * tidak ada fallback ke .env atau kredensial default.
 */
export function assertIsolatedTestDatabase(
  url: string | undefined,
  label: string,
): void {
  if (process.env.S1_TEST_DB_GUARD !== "1") {
    throw new Error(`${label}: S1_TEST_DB_GUARD=1 wajib untuk test destruktif`);
  }
  const expectedName = process.env.S1_TEST_DB_NAME;
  const expectedHost = process.env.S1_TEST_DB_HOST;
  const expectedPort = process.env.S1_TEST_DB_PORT;
  if (!expectedName || !expectedHost || !expectedPort) {
    throw new Error(`${label}: S1_TEST_DB_NAME/HOST/PORT wajib diisi eksplisit`);
  }
  if (!/^absensi_s1_verify_[a-z0-9]+$/.test(expectedName)) {
    throw new Error(`${label}: nama database verifikasi tidak valid`);
  }
  if (!url) throw new Error(`${label}: URL database wajib diisi`);

  const parsed = new URL(url);
  const databaseName = parsed.pathname.replace(/^\//, "");
  if (parsed.protocol !== "mysql:" && parsed.protocol !== "mariadb:") {
    throw new Error(`${label}: protokol database tidak didukung`);
  }
  if (parsed.hostname !== expectedHost || parsed.port !== expectedPort) {
    throw new Error(`${label}: host/port tidak sama dengan target yang disetujui`);
  }
  if (databaseName !== expectedName) {
    throw new Error(`${label}: nama database tidak sama dengan target yang disetujui`);
  }
  if (FORBIDDEN_DATABASE_NAMES.has(databaseName)) {
    throw new Error(`${label}: database development/production ditolak`);
  }
  if (!parsed.username.startsWith("s1_")) {
    throw new Error(`${label}: user database bukan user verifikasi`);
  }
  if ([...parsed.searchParams.keys()].length > 0) {
    throw new Error(`${label}: parameter koneksi tambahan ditolak`);
  }
}

export function adminClient(): PrismaClient {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL wajib untuk test");
  assertIsolatedTestDatabase(url, "DATABASE_URL");
  return createPrismaClient(url);
}

export async function resetDatabase(db: PrismaClient): Promise<void> {
  assertIsolatedTestDatabase(process.env.DATABASE_URL, "DATABASE_URL");
  assertIsolatedTestDatabase(process.env.APP_DATABASE_URL, "APP_DATABASE_URL");
  await db.deviceToken.deleteMany();
  await db.memberDevice.deleteMany();
  await db.payrollItem.deleteMany();
  await db.payrollRun.deleteMany();
  await db.memberCompensation.deleteMany();
  await db.payrollSetting.deleteMany();
  await db.clientVisitLog.deleteMany();
  await db.clientVisitSchedule.deleteMany();
  await db.clientVisitSetting.deleteMany();
  await db.client.deleteMany();
  await db.workProjection.deleteMany();
  await db.companyProfile.deleteMany();
  await db.memberLeaveBalance.deleteMany();
  await db.leaveRequest.deleteMany();
  await db.leavePolicy.deleteMany();
  await db.workPermit.deleteMany();
  await db.warningLetter.deleteMany();
  await db.broadcastMessage.deleteMany();
  await db.approvalStep.deleteMany();
  await db.approvalWorkflow.deleteMany();
  await db.correctionRequest.deleteMany();
  await db.memberShift.deleteMany();
  await db.overtimeSchedule.deleteMany();
  await db.overtimeSetting.deleteMany();
  await db.overtimeRequest.deleteMany();
  await db.workPatternAssignment.deleteMany();
  await db.workPatternDay.deleteMany();
  await db.workPattern.deleteMany();
  await db.attendanceSetting.deleteMany();
  await db.wfhRequest.deleteMany();
  await db.workspaceHoliday.deleteMany();
  await db.attendanceLog.deleteMany();
  // FKs baru: member.office_location_id dan attendance.office_location_id
  // membatasi penghapusan kantor. Log sudah dihapus; lepaskan penugasan dulu.
  // Divisi/jabatan juga dibatasi FK dari member, jadi lepaskan sebelum hapus.
  await db.workspaceMember.updateMany({
    data: {
      officeLocationId: null,
      divisionId: null,
      positionId: null,
      photoUrl: null,
      photoStatus: "NONE",
      photoReviewedByMemberId: null,
    },
  });
  await db.position.deleteMany();
  await db.division.deleteMany();
  await db.officeLocation.deleteMany();
  await db.backgroundJobAttempt.deleteMany();
  await db.backgroundJob.deleteMany();
  await db.memberRole.deleteMany();
  await db.workspaceInvitation.deleteMany();
  await db.rolePermission.deleteMany();
  await db.workspaceMember.deleteMany();
  await db.role.deleteMany();
  await db.session.deleteMany();
  await db.workspace.deleteMany();
  await db.auditLog.deleteMany();
  await db.user.deleteMany();
}

export type SeededTenant = {
  tenantId: string;
  roles: Record<RoleKey, string>;
  ownerUserId: string;
  ownerMemberId: string;
  ownerEmail: string;
  ownerToken: string;
};

export async function seedTenant(
  db: PrismaClient,
  options: { name?: string; passwordHash?: string } = {},
): Promise<SeededTenant> {
  const tenantId = randomUUID();
  const ownerUserId = randomUUID();
  const ownerMemberId = randomUUID();
  const ownerEmail = `owner-${ownerUserId}@test.local`;

  await db.$transaction(async (tx) => {
    await tx.user.create({
      data: {
        id: ownerUserId,
        email: ownerEmail,
        passwordHash: options.passwordHash ?? "x",
        name: "Owner",
      },
    });
    await tx.workspace.create({
      data: { id: tenantId, name: options.name ?? "Tenant Test", slug: `t-${tenantId}` },
    });
    const roles = await createDefaultRolesForWorkspace(tx, tenantId);
    await tx.workspaceMember.create({
      data: {
        id: ownerMemberId,
        tenantId,
        userId: ownerUserId,
        status: "ACTIVE",
        joinedAt: new Date(),
      },
    });
    await tx.memberRole.create({
      data: { tenantId, memberId: ownerMemberId, roleId: roles.WORKSPACE_OWNER },
    });
  });

  const roles = {} as Record<RoleKey, string>;
  const rows = await db.role.findMany({ where: { tenantId } });
  for (const row of rows) {
    if ((ROLE_KEYS as readonly string[]).includes(row.key)) roles[row.key as RoleKey] = row.id;
  }

  const { token } = await createSession({
    userId: ownerUserId,
    activeTenantId: tenantId,
    ip: "127.0.0.1",
  });

  return { tenantId, roles, ownerUserId, ownerMemberId, ownerEmail, ownerToken: token };
}

/**
 * Fixture hari libur untuk test: 25 Desember, 1 Januari, dan satu cuti
 * bersama. Hanya dipakai suite test, bukan production.
 */
export async function seedHolidays(
  db: PrismaClient,
  tenantId: string,
  entries: Array<{ date: string; name: string }> = [
    { date: "2026-12-25", name: "Hari Raya Natal" },
    { date: "2027-01-01", name: "Tahun Baru" },
    { date: "2026-12-24", name: "Cuti bersama Natal" },
  ],
): Promise<Array<{ id: string; date: string; name: string }>> {
  const rows = [];
  for (const entry of entries) {
    const id = randomUUID();
    await db.workspaceHoliday.create({
      data: {
        id,
        tenantId,
        date: new Date(`${entry.date}T00:00:00.000Z`),
        name: entry.name,
      },
    });
    rows.push({ id, date: entry.date, name: entry.name });
  }
  return rows;
}

/** Buat user + membership ACTIVE dengan satu role, beserta session-nya. */
export async function seedMember(
  db: PrismaClient,
  tenantId: string,
  roleId: string,
  options: { email?: string; passwordHash?: string } = {},
): Promise<{ userId: string; memberId: string; email: string; token: string }> {
  const userId = randomUUID();
  const memberId = randomUUID();
  const email = options.email ?? `member-${userId}@test.local`;
  await db.user.create({
    data: { id: userId, email, passwordHash: options.passwordHash ?? "x", name: "Member" },
  });
  await db.workspaceMember.create({
    data: { id: memberId, tenantId, userId, status: "ACTIVE", joinedAt: new Date() },
  });
  await db.memberRole.create({ data: { tenantId, memberId, roleId } });
  const { token } = await createSession({ userId, activeTenantId: tenantId, ip: "127.0.0.1" });
  return { userId, memberId, email, token };
}

export function bearerRequest(
  token: string,
  options: { method?: string; body?: unknown; url?: string; csrf?: string } = {},
): Request {
  const headers: Record<string, string> = {
    authorization: `Bearer ${token}`,
    "content-type": "application/json",
  };
  if (options.csrf) headers["x-csrf-token"] = options.csrf;
  return new Request(options.url ?? "http://localhost/api/test", {
    method: options.method ?? "GET",
    headers,
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  });
}

export function cookieRequest(
  token: string,
  options: { method?: string; csrf?: string; url?: string; body?: unknown } = {},
): Request {
  const headers: Record<string, string> = {
    cookie: `aos_session=${token}${options.csrf ? `; aos_csrf=${options.csrf}` : ""}`,
    "content-type": "application/json",
  };
  if (options.csrf) headers["x-csrf-token"] = options.csrf;
  return new Request(options.url ?? "http://localhost/api/test", {
    method: options.method ?? "GET",
    headers,
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  });
}
