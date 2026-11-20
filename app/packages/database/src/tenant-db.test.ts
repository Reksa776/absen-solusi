import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test, { after, before } from "node:test";

import { createPrismaClient } from "./client.js";
import type { Prisma, PrismaClient } from "./generated/prisma/client.js";
import { createDefaultRolesForWorkspace, resolveMemberPermissions } from "./rbac.js";
import { createTenantContext, type TenantContext } from "./tenancy.js";
import {
  TenantAppendOnlyError,
  TenantModelAccessError,
  TenantNestedWriteError,
  TenantRawQueryError,
  TenantWriteScopeError,
  withTenant,
} from "./tenant-db.js";
import { assertIsolatedTestDatabase } from "./test-db-guard.js";

let admin: PrismaClient = null as unknown as PrismaClient;
let app: PrismaClient = null as unknown as PrismaClient;

const tenantA = randomUUID();
const tenantB = randomUUID();
const userA = randomUUID();
const userB = randomUUID();
const userC = randomUUID();
const userD = randomUUID();
const userE = randomUUID();
const memberA = randomUUID();
const memberB = randomUUID();

let ctxA: TenantContext;
let ctxB: TenantContext;

async function cleanup(client: PrismaClient): Promise<void> {
  await client.deviceToken.deleteMany();
  await client.correctionRequest.deleteMany();
  await client.workspaceHoliday.deleteMany();
  await client.attendanceLog.deleteMany();
  await client.officeLocation.deleteMany();
  await client.backgroundJobAttempt.deleteMany();
  await client.backgroundJob.deleteMany();
  await client.memberRole.deleteMany();
  await client.workspaceInvitation.deleteMany();
  await client.rolePermission.deleteMany();
  await client.workspaceMember.deleteMany();
  await client.role.deleteMany();
  await client.session.deleteMany();
  await client.workspace.deleteMany();
  await client.auditLog.deleteMany();
  await client.user.deleteMany();
}

before(async () => {
  assert.ok(process.env.DATABASE_URL, "DATABASE_URL wajib untuk test admin");
  assertIsolatedTestDatabase(process.env.DATABASE_URL, "DATABASE_URL");
  assertIsolatedTestDatabase(process.env.APP_DATABASE_URL, "APP_DATABASE_URL");
  admin = createPrismaClient(process.env.DATABASE_URL);
  app = createPrismaClient(process.env.APP_DATABASE_URL);
  await cleanup(admin);

  await admin.user.createMany({
    data: [
      { id: userA, email: `a-${userA}@test.local`, passwordHash: "x", name: "User A" },
      { id: userB, email: `b-${userB}@test.local`, passwordHash: "x", name: "User B" },
      { id: userC, email: `c-${userC}@test.local`, passwordHash: "x", name: "User C" },
      { id: userD, email: `d-${userD}@test.local`, passwordHash: "x", name: "User D" },
      { id: userE, email: `e-${userE}@test.local`, passwordHash: "x", name: "User E" },
    ],
  });

  await admin.$transaction(async (tx: Prisma.TransactionClient) => {
    await tx.workspace.create({
      data: { id: tenantA, name: "Tenant A", slug: `a-${tenantA}` },
    });
    await tx.workspace.create({
      data: { id: tenantB, name: "Tenant B", slug: `b-${tenantB}` },
    });
    const rolesA = await createDefaultRolesForWorkspace(tx, tenantA);
    const rolesB = await createDefaultRolesForWorkspace(tx, tenantB);
    await tx.workspaceMember.create({
      data: { id: memberA, tenantId: tenantA, userId: userA, status: "ACTIVE", joinedAt: new Date() },
    });
    await tx.workspaceMember.create({
      data: { id: memberB, tenantId: tenantB, userId: userB, status: "ACTIVE", joinedAt: new Date() },
    });
    await tx.memberRole.create({
      data: { tenantId: tenantA, memberId: memberA, roleId: rolesA.WORKSPACE_OWNER! },
    });
    await tx.memberRole.create({
      data: { tenantId: tenantB, memberId: memberB, roleId: rolesB.WORKSPACE_OWNER! },
    });
  });

  const permsA = await resolveMemberPermissions(admin, tenantA, memberA);
  const permsB = await resolveMemberPermissions(admin, tenantB, memberB);
  ctxA = createTenantContext({ tenantId: tenantA, userId: userA, memberId: memberA, ...permsA });
  ctxB = createTenantContext({ tenantId: tenantB, userId: userB, memberId: memberB, ...permsB });
});

after(async () => {
  if (!admin) return;
  await cleanup(admin);
  await admin.$disconnect();
  if (app) await app.$disconnect();
});

test("T1: withTenant(A).workspaceMember hanya melihat baris A", async () => {
  const rows = await withTenant(ctxA, (db) => db.workspaceMember.findMany());
  assert.deepEqual(rows.map((row) => row.id), [memberA]);
});

test("T2: withTenant(A).workspace hanya workspace A", async () => {
  const rows = await withTenant(ctxA, (db) => db.workspace.findMany());
  assert.deepEqual(rows.map((row) => row.id), [tenantA]);
});

test("T3: create tanpa tenantId diisi otomatis dari context", async () => {
  const id = randomUUID();
  const row = await withTenant(ctxA, (db) =>
    db.workspaceMember.create({
      data: { id, tenantId: tenantA, userId: userC, status: "ACTIVE", joinedAt: new Date() } as never,
    }),
  );
  assert.equal(row.tenantId, tenantA);
});

test("T4: create yang menamai tenant lain ditimpa menjadi tenant context", async () => {
  const id = randomUUID();
  const row = await withTenant(ctxA, (db) =>
    db.workspaceMember.create({
      data: { id, tenantId: tenantB, userId: userD, status: "ACTIVE" } as never,
    }),
  );
  assert.equal(row.tenantId, tenantA);
});

test("T5: update baris tenant lain ditolak", async () => {
  await assert.rejects(
    () =>
      withTenant(ctxA, (db) =>
        db.workspaceMember.update({ where: { id: memberB }, data: { status: "INACTIVE" } }),
      ),
    /lintas tenant/i,
  );
  const row = await admin.workspaceMember.findUnique({ where: { id: memberB } });
  assert.equal(row?.status, "ACTIVE");
});

test("T6: delete baris tenant lain ditolak dan baris tetap ada", async () => {
  await assert.rejects(
    () => withTenant(ctxA, (db) => db.workspaceMember.delete({ where: { id: memberB } })),
    /lintas tenant/i,
  );
  const row = await admin.workspaceMember.findUnique({ where: { id: memberB } });
  assert.ok(row);
});

test("T7: model global (User) tidak bisa diakses lewat withTenant", async () => {
  await assert.rejects(
    () => withTenant(ctxA, (db) => db.user.findMany()),
    TenantModelAccessError,
  );
});

test("T8: audit_logs update/delete lewat withTenant ditolak guard aplikasi", async () => {
  const id = randomUUID();
  await withTenant(ctxA, (db) =>
    db.auditLog.create({
      data: {
        tenantId: tenantA,
        id,
        actorType: "USER",
        actorUserId: userA,
        actorMemberId: memberA,
        action: "test.event",
        resourceType: "test.resource",
      },
    }),
  );
  await assert.rejects(
    () => withTenant(ctxA, (db) => db.auditLog.update({ where: { id }, data: { action: "x.y" } })),
    TenantAppendOnlyError,
  );
  await assert.rejects(
    () => withTenant(ctxA, (db) => db.auditLog.delete({ where: { id } })),
    TenantAppendOnlyError,
  );
  const row = await admin.auditLog.findUnique({ where: { id } });
  assert.equal(row?.action, "test.event");
});

test("T9: ctxB tidak melihat baris tenant A", async () => {
  const rows = await withTenant(ctxB, (db) => db.workspaceMember.findMany());
  assert.equal(rows.some((row) => row.id === memberA), false);
});

test("T10: update data tenantId ditolak dan baris A tetap di A", async () => {
  await assert.rejects(
    () =>
      withTenant(ctxA, (db) =>
        db.workspaceMember.update({
          where: { id: memberA },
          data: { tenantId: tenantB, status: "INACTIVE" } as never,
        }),
      ),
    TenantWriteScopeError,
  );

  const row = await admin.workspaceMember.findUnique({ where: { id: memberA } });
  assert.equal(row?.tenantId, tenantA);
  assert.equal(row?.status, "ACTIVE");
});

test("T11: updateMany data tenantId ditolak", async () => {
  await assert.rejects(
    () =>
      withTenant(ctxA, (db) =>
        db.workspaceMember.updateMany({
          where: { id: memberA },
          data: { tenantId: tenantB } as never,
        }),
      ),
    TenantWriteScopeError,
  );
  assert.equal((await admin.workspaceMember.findUnique({ where: { id: memberA } }))?.tenantId, tenantA);
});

test("T12: upsert memaksa create ke tenant A dan menolak update tenantId", async () => {
  const id = randomUUID();
  const created = await withTenant(ctxA, (db) =>
    db.workspaceMember.upsert({
      where: { tenantId_userId: { tenantId: tenantA, userId: userE } },
      create: { id, tenantId: tenantB, userId: userE, status: "ACTIVE" } as never,
      update: { status: "ACTIVE" },
    }),
  );
  assert.equal(created.tenantId, tenantA);

  await assert.rejects(
    () =>
      withTenant(ctxA, (db) =>
        db.workspaceMember.upsert({
          where: { id: memberA },
          create: { id: randomUUID(), tenantId: tenantB, userId: userD, status: "ACTIVE" } as never,
          update: { tenantId: tenantB } as never,
        }),
      ),
    TenantWriteScopeError,
  );
  assert.equal((await admin.workspaceMember.findUnique({ where: { id: memberA } }))?.tenantId, tenantA);
});

test("T13: nested write ditolak sebelum menyentuh database", async () => {
  await assert.rejects(
    () =>
      withTenant(ctxA, (db) =>
        db.workspaceMember.update({
          where: { id: memberA },
          data: {
            roles: { create: { tenantId: tenantB, roleId: randomUUID() } },
          } as never,
        }),
      ),
    TenantNestedWriteError,
  );
  assert.equal((await admin.workspaceMember.findUnique({ where: { id: memberA } }))?.tenantId, tenantA);
});

test("T14: raw query pada client tenant ditolak", async () => {
  await assert.rejects(
    () => withTenant(ctxA, (db) => db.$queryRawUnsafe("SELECT 1")),
    TenantRawQueryError,
  );
});

test("T16: correction_requests terisolasi per tenant dan tenantId tidak bisa dipindah", async () => {
  const requestA = randomUUID();
  const requestB = randomUUID();
  const requestedTimestamp = new Date("2026-11-20T03:00:00Z");
  const createData = (id: string, memberId: string, tenantId: string) => ({
    id,
    tenantId,
    memberId,
    requestType: "CHECK_IN",
    requestedTimestamp,
    reason: "Lupa check-in karena gangguan jaringan kantor",
    status: "PENDING",
  });

  await withTenant(ctxA, (db) =>
    db.correctionRequest.create({ data: createData(requestA, memberA, tenantB) as never }),
  );
  await withTenant(ctxB, (db) =>
    db.correctionRequest.create({ data: createData(requestB, memberB, tenantB) as never }),
  );

  const rows = await withTenant(ctxA, (db) => db.correctionRequest.findMany());
  assert.deepEqual(rows.map((row) => row.id), [requestA]);
  assert.equal(rows[0]?.tenantId, tenantA);

  const other = await withTenant(ctxB, (db) => db.correctionRequest.findMany());
  assert.equal(other.some((row) => row.id === requestA), false);

  await assert.rejects(
    () =>
      withTenant(ctxA, (db) =>
        db.correctionRequest.update({
          where: { id: requestA },
          data: { tenantId: tenantB } as never,
        }),
      ),
    TenantWriteScopeError,
  );
  assert.equal(
    (await admin.correctionRequest.findUnique({ where: { id: requestA } }))?.tenantId,
    tenantA,
  );
});

test("T18: device_tokens terisolasi per tenant dan tenantId tidak bisa dipindah", async () => {
  const tokenA = randomUUID();
  await withTenant(ctxA, (db) =>
    db.deviceToken.create({
      data: {
        id: tokenA,
        tenantId: tenantB,
        memberId: memberA,
        token: "device-token-tenant-a",
        platform: "ANDROID",
      } as never,
    }),
  );

  const rowsA = await withTenant(ctxA, (db) => db.deviceToken.findMany());
  assert.deepEqual(rowsA.map((row) => row.id), [tokenA]);
  assert.equal(rowsA[0]?.tenantId, tenantA);

  const rowsB = await withTenant(ctxB, (db) => db.deviceToken.findMany());
  assert.equal(rowsB.some((row) => row.id === tokenA), false);

  await assert.rejects(
    () =>
      withTenant(ctxA, (db) =>
        db.deviceToken.update({
          where: { id: tokenA },
          data: { tenantId: tenantB } as never,
        }),
      ),
    TenantWriteScopeError,
  );
  assert.equal(
    (await admin.deviceToken.findUnique({ where: { id: tokenA } }))?.tenantId,
    tenantA,
  );
});

test("T17: workspace_holidays terisolasi dan tenantId tidak bisa dipindah", async () => {
  const holidayA = randomUUID();
  const holidayB = randomUUID();
  const date = new Date("2026-12-25T00:00:00.000Z");

  await withTenant(ctxA, (db) =>
    db.workspaceHoliday.create({
      data: { id: holidayA, tenantId: tenantB, date, name: "Natal" } as never,
    }),
  );
  await withTenant(ctxB, (db) =>
    db.workspaceHoliday.create({
      data: { id: holidayB, tenantId: tenantB, date, name: "Natal B" } as never,
    }),
  );

  const rows = await withTenant(ctxA, (db) => db.workspaceHoliday.findMany());
  assert.deepEqual(rows.map((row) => row.id), [holidayA]);
  assert.equal(rows[0]?.tenantId, tenantA);

  const other = await withTenant(ctxB, (db) => db.workspaceHoliday.findMany());
  assert.equal(other.some((row) => row.id === holidayA), false);

  await assert.rejects(
    () =>
      withTenant(ctxA, (db) =>
        db.workspaceHoliday.update({
          where: { tenantId_id: { tenantId: tenantA, id: holidayA } },
          data: { tenantId: tenantB } as never,
        }),
      ),
    TenantWriteScopeError,
  );
  assert.equal(
    (await admin.workspaceHoliday.findUnique({
      where: { tenantId_id: { tenantId: tenantA, id: holidayA } },
    }))?.tenantId,
    tenantA,
  );
});

test("T15: office/attendance hanya terlihat oleh tenant sendiri dan tenantId tidak bisa dipindah", async () => {
  const officeA = randomUUID();
  const officeB = randomUUID();
  await withTenant(ctxA, (db) =>
    db.officeLocation.create({
      data: {
        id: officeA,
        tenantId: tenantB,
        name: "Office A",
        latitude: -6.2,
        longitude: 106.8,
        radiusMeters: 100,
        timezone: "Asia/Jakarta",
        workStart: "09:00",
        workEnd: "17:00",
      },
    }),
  );
  await withTenant(ctxB, (db) =>
    db.officeLocation.create({
      data: {
        id: officeB,
        tenantId: tenantB,
        name: "Office B",
        latitude: -6.3,
        longitude: 106.9,
        radiusMeters: 100,
        timezone: "Asia/Jakarta",
        workStart: "09:00",
        workEnd: "17:00",
      },
    }),
  );
  const rows = await withTenant(ctxA, (db) => db.officeLocation.findMany());
  assert.deepEqual(rows.map((row) => row.id), [officeA]);
  assert.equal(rows[0]?.tenantId, tenantA);
  await assert.rejects(
    () =>
      withTenant(ctxA, (db) =>
        db.officeLocation.update({
          where: { id: officeA },
          data: { tenantId: tenantB } as never,
        }),
      ),
    TenantWriteScopeError,
  );
  assert.equal((await admin.officeLocation.findUnique({ where: { id: officeA } }))?.tenantId, tenantA);
});
