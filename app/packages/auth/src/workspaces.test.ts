import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test, { after, before } from "node:test";

import {
  createTenantContext,
  resolveMemberPermissions,
  withTenant,
  type PrismaClient,
} from "@absensi/database";
import { ALL_PERMISSIONS } from "@absensi/permissions";

import { HttpError } from "./http.js";
import {
  changeMemberRole,
  createWorkspace,
  invitationResponse,
  inviteMember,
  listWorkspaceMembers,
  transferOwnership,
} from "./workspaces.js";
import { adminClient, resetDatabase, seedMember, seedTenant } from "./test-support.js";
import { validateSession } from "./session.js";

let db: PrismaClient = null as unknown as PrismaClient;

before(async () => {
  db = adminClient();
  await resetDatabase(db);
});

after(async () => {
  if (!db) return;
  await resetDatabase(db);
  await db.$disconnect();
});

async function ctxFor(tenantId: string, userId: string, memberId: string) {
  const perms = await resolveMemberPermissions(db, tenantId, memberId);
  return createTenantContext({ tenantId, userId, memberId, ...perms });
}

async function failAuditWrites<T>(work: () => Promise<T>): Promise<T> {
  await db.$executeRawUnsafe("DROP TRIGGER IF EXISTS test_fail_audit_insert");
  await db.$executeRawUnsafe(
    "CREATE TRIGGER test_fail_audit_insert BEFORE INSERT ON audit_logs FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'audit injected failure'",
  );
  try {
    return await work();
  } finally {
    await db.$executeRawUnsafe("DROP TRIGGER IF EXISTS test_fail_audit_insert");
  }
}

test("D1: create workspace atomik — 8 role, membership ACTIVE, owner, audit", async () => {
  const tenant = await seedTenant(db);
  const result = await createWorkspace({
    userId: tenant.ownerUserId,
    name: "Workspace Baru",
    ip: "203.0.113.5",
  });

  assert.equal(await db.role.count({ where: { tenantId: result.workspace.id } }), 8);
  const member = await db.workspaceMember.findUnique({ where: { id: result.memberId } });
  assert.equal(member?.status, "ACTIVE");
  assert.equal(member?.userId, tenant.ownerUserId);
  const assignments = await db.memberRole.findMany({ where: { memberId: result.memberId } });
  assert.deepEqual(assignments.map((row) => row.roleId), [result.roles.WORKSPACE_OWNER]);

  const audit = await db.auditLog.findFirst({
    where: { action: "workspace.create", tenantId: result.workspace.id },
  });
  assert.ok(audit);
  assert.equal(audit?.actorUserId, tenant.ownerUserId);
  assert.equal(audit?.ipHash?.length, 32);
});

test("D2: create workspace rollback penuh bila provisioning gagal", async () => {
  const tenant = await seedTenant(db);
  const before = await db.workspace.count();
  const rolesBefore = await db.role.count();
  // Hapus katalog permission sementara agar assertCatalogSeeded gagal di tengah transaksi.
  // Tenant di atas sudah dibuat selagi katalog masih utuh; finally selalu memulihkan.
  await db.permission.deleteMany();
  try {
    await assert.rejects(() => createWorkspace({ userId: tenant.ownerUserId, name: "Gagal" }));
    assert.equal(await db.workspace.count(), before);
    assert.equal(await db.role.count(), rolesBefore);
  } finally {
    // Pulihkan katalog agar test berikutnya tidak bergantung pada urutan.
    await db.permission.createMany({
      data: ALL_PERMISSIONS.map((key) => ({ key, description: "restored-by-test" })),
      skipDuplicates: true,
    });
  }
});

test("D3: invite member menyimpan SHA-256 token 32 byte, expiry 7 hari, dan audit tanpa token", async () => {
  const tenant = await seedTenant(db);
  const ctx = await ctxFor(tenant.tenantId, tenant.ownerUserId, tenant.ownerMemberId);
  const result = await inviteMember({
    ctx,
    workspaceId: tenant.tenantId,
    email: "Undangan@Example.com",
    role: "ANALYST",
    ip: "203.0.113.6",
  });

  const row = await db.workspaceInvitation.findUnique({ where: { id: result.invitationId } });
  assert.equal(row?.email, "undangan@example.com");
  assert.equal(row?.status, "PENDING");
  assert.equal(row?.tokenHash.length, 64);
  assert.equal(row?.tokenHash, createHash("sha256").update(result.token).digest("hex"));
  const ttl = (row?.expiresAt.getTime() ?? 0) - Date.now();
  assert.ok(ttl > 6.9 * 24 * 3600 * 1000 && ttl <= 7 * 24 * 3600 * 1000);

  const audit = await db.auditLog.findFirst({ where: { action: "member.invite" } });
  const metadata = JSON.stringify(audit?.metadata);
  assert.equal(metadata.includes(result.token), false);
  assert.equal(metadata.includes(row?.tokenHash ?? "x"), false);
  assert.equal(audit?.actorUserId, tenant.ownerUserId);
  assert.equal(audit?.ipHash?.length, 32);
});

test("D4: invite duplikat (member aktif / undangan pending) ditolak 409 tanpa baris baru", async () => {
  const tenant = await seedTenant(db);
  const ctx = await ctxFor(tenant.tenantId, tenant.ownerUserId, tenant.ownerMemberId);
  const existing = await seedMember(db, tenant.tenantId, tenant.roles.VIEWER);

  const countBefore = await db.workspaceInvitation.count();
  await assert.rejects(
    () => inviteMember({ ctx, workspaceId: tenant.tenantId, email: existing.email }),
    (error: unknown) => error instanceof HttpError && error.status === 409,
  );

  await inviteMember({ ctx, workspaceId: tenant.tenantId, email: "pending@example.com" });
  await assert.rejects(
    () => inviteMember({ ctx, workspaceId: tenant.tenantId, email: "pending@example.com" }),
    (error: unknown) => error instanceof HttpError && error.status === 409,
  );
  assert.equal(await db.workspaceInvitation.count(), countBefore + 1);
});

test("D5: cross-tenant invite/role-change 404 identik dengan workspace tidak ada, tanpa baris tertulis", async () => {
  const a = await seedTenant(db, { name: "A" });
  const b = await seedTenant(db, { name: "B" });
  const ctxA = await ctxFor(a.tenantId, a.ownerUserId, a.ownerMemberId);
  const target = await seedMember(db, b.tenantId, b.roles.VIEWER);

  const invitationCount = await db.workspaceInvitation.count();
  const roleCount = await db.memberRole.count();

  async function capture(fn: () => Promise<unknown>): Promise<{ status: number; message: string }> {
    try {
      await fn();
      throw new Error("harus gagal");
    } catch (error) {
      if (error instanceof HttpError) return { status: error.status, message: error.message };
      throw error;
    }
  }

  const foreign = await capture(() =>
    inviteMember({ ctx: ctxA, workspaceId: b.tenantId, email: "orang@example.com" }),
  );
  const missing = await capture(() =>
    inviteMember({ ctx: ctxA, workspaceId: "00000000-0000-4000-8000-000000000000", email: "orang@example.com" }),
  );
  assert.deepEqual(foreign, missing);
  assert.equal(foreign.status, 404);

  const roleForeign = await capture(() =>
    changeMemberRole({ ctx: ctxA, workspaceId: b.tenantId, memberId: target.memberId, role: "ANALYST" }),
  );
  const roleMissing = await capture(() =>
    changeMemberRole({ ctx: ctxA, workspaceId: "00000000-0000-4000-8000-000000000000", memberId: target.memberId, role: "ANALYST" }),
  );
  assert.deepEqual(roleForeign, roleMissing);
  assert.equal(roleForeign.status, 404);

  assert.equal(await db.workspaceInvitation.count(), invitationCount);
  assert.equal(await db.memberRole.count(), roleCount);
});

test("D6: self role change ditolak 400; role change menulis audit from→to", async () => {
  const tenant = await seedTenant(db);
  const ctx = await ctxFor(tenant.tenantId, tenant.ownerUserId, tenant.ownerMemberId);
  const member = await seedMember(db, tenant.tenantId, tenant.roles.VIEWER);

  await assert.rejects(
    () => changeMemberRole({ ctx, workspaceId: tenant.tenantId, memberId: ctx.memberId, role: "VIEWER" }),
    (error: unknown) => error instanceof HttpError && error.status === 400,
  );

  const result = await changeMemberRole({
    ctx,
    workspaceId: tenant.tenantId,
    memberId: member.memberId,
    role: "ANALYST",
    ip: "203.0.113.7",
  });
  assert.equal(result.changed, true);

  const audit = await db.auditLog.findFirst({ where: { action: "role.change", resourceId: member.memberId } });
  assert.ok(audit);
  const metadata = audit?.metadata as { from?: string[]; to?: string } | null;
  assert.deepEqual(metadata?.from, [tenant.roles.VIEWER]);
  assert.equal(metadata?.to, "ANALYST");
  assert.equal(audit?.ipHash?.length, 32);
});

test("D7: role change ke member tenant lain lewat ctx sendiri tidak menemukan baris", async () => {
  const a = await seedTenant(db);
  const b = await seedTenant(db);
  const ctxA = await ctxFor(a.tenantId, a.ownerUserId, a.ownerMemberId);
  const victim = await seedMember(db, a.tenantId, a.roles.VIEWER);

  // memberId milik B tidak mungkin diakses lewat ctx A (extension tenant).
  const foreignMember = await seedMember(db, b.tenantId, b.roles.VIEWER);
  await assert.rejects(
    () => changeMemberRole({ ctx: ctxA, workspaceId: a.tenantId, memberId: foreignMember.memberId, role: "ANALYST" }),
    (error: unknown) => error instanceof HttpError && error.status === 404,
  );
  const stillViewer = await db.memberRole.findFirst({
    where: { tenantId: a.tenantId, memberId: victim.memberId },
  });
  assert.equal(stillViewer?.roleId, a.roles.VIEWER);
});

test("L1: list member hanya mengembalikan tenant context, bukan tenant lain", async () => {
  const a = await seedTenant(db, { name: "List A" });
  const b = await seedTenant(db, { name: "List B" });
  const ctxA = await ctxFor(a.tenantId, a.ownerUserId, a.ownerMemberId);
  const memberA = await seedMember(db, a.tenantId, a.roles.VIEWER);
  const memberB = await seedMember(db, b.tenantId, b.roles.VIEWER);

  const result = await listWorkspaceMembers({ ctx: ctxA, workspaceId: a.tenantId });
  const ids = result.members.map((row) => row.id).sort();
  assert.deepEqual(ids, [a.ownerMemberId, memberA.memberId].sort());
  assert.equal(ids.includes(memberB.memberId), false);
  assert.equal(result.pagination.total, 2);
});

test("L2: pagination default 50, halaman stabil tanpa duplikat", async () => {
  const tenant = await seedTenant(db);
  const ctx = await ctxFor(tenant.tenantId, tenant.ownerUserId, tenant.ownerMemberId);
  for (let index = 0; index < 3; index += 1) {
    await seedMember(db, tenant.tenantId, tenant.roles.VIEWER);
  }

  const all = await listWorkspaceMembers({ ctx, workspaceId: tenant.tenantId });
  assert.deepEqual(all.pagination, { limit: 50, offset: 0, total: 4 });

  const first = await listWorkspaceMembers({ ctx, workspaceId: tenant.tenantId, limit: 2, offset: 0 });
  const second = await listWorkspaceMembers({ ctx, workspaceId: tenant.tenantId, limit: 2, offset: 2 });
  assert.equal(first.members.length, 2);
  assert.equal(second.members.length, 2);

  const paged = [...first.members, ...second.members].map((row) => row.id);
  assert.deepEqual(paged, all.members.map((row) => row.id));
  assert.equal(new Set(paged).size, 4);
  assert.equal(first.pagination.total, 4);
  assert.equal(second.pagination.total, 4);
});

test("L3: limit/offset tidak valid ditolak 400 INVALID_PAGINATION", async () => {
  const tenant = await seedTenant(db);
  const ctx = await ctxFor(tenant.tenantId, tenant.ownerUserId, tenant.ownerMemberId);

  const cases: Array<[number | undefined, number | undefined]> = [
    [0, 0],
    [101, 0],
    [1.5, 0],
    [Number.NaN, 0],
    [undefined, -1],
    [undefined, 1.5],
  ];

  for (const [limit, offset] of cases) {
    await assert.rejects(
      () => listWorkspaceMembers({ ctx, workspaceId: tenant.tenantId, limit, offset }),
      (error: unknown) =>
        error instanceof HttpError &&
        error.status === 400 &&
        error.code === "INVALID_PAGINATION",
    );
  }
});

test("L4: workspace asing dan tidak ada memberi 403 identik pada read", async () => {
  const a = await seedTenant(db, { name: "Foreign A" });
  const b = await seedTenant(db, { name: "Foreign B" });
  const ctxA = await ctxFor(a.tenantId, a.ownerUserId, a.ownerMemberId);

  async function capture(): Promise<{ status: number; code: string; message: string }> {
    try {
      await listWorkspaceMembers({ ctx: ctxA, workspaceId: b.tenantId });
      throw new Error("harus gagal");
    } catch (error) {
      if (error instanceof HttpError) {
        return { status: error.status, code: error.code, message: error.message };
      }
      throw error;
    }
  }

  const foreign = await capture();
  const missingCtx = await ctxFor(a.tenantId, a.ownerUserId, a.ownerMemberId);
  assert.equal(foreign.status, 403);
  assert.equal(foreign.code, "WORKSPACE_NOT_FOUND");

  await assert.rejects(
    () =>
      listWorkspaceMembers({
        ctx: missingCtx,
        workspaceId: "00000000-0000-4000-8000-000000000000",
      }),
    (error: unknown) =>
      error instanceof HttpError &&
      error.status === foreign.status &&
      error.code === foreign.code &&
      error.message === foreign.message,
  );
});

test("L5: respons member tidak memuat hash/token dan field dibatasi", async () => {
  const tenant = await seedTenant(db);
  const ctx = await ctxFor(tenant.tenantId, tenant.ownerUserId, tenant.ownerMemberId);
  const result = await listWorkspaceMembers({ ctx, workspaceId: tenant.tenantId });
  const serialized = JSON.stringify(result);

  for (const forbidden of ["passwordHash", "password_hash", "tokenHash", "token_hash", "ipHash"]) {
    assert.equal(serialized.includes(forbidden), false, `respons memuat ${forbidden}`);
  }

  assert.deepEqual(Object.keys(result.members[0] ?? {}).sort(), [
    "id",
    "joinedAt",
    "officeLocationId",
    "roleKeys",
    "status",
    "user",
  ]);
  assert.deepEqual(Object.keys(result.members[0]?.user ?? {}).sort(), ["email", "id", "name"]);
  assert.deepEqual(result.members[0]?.roleKeys, ["WORKSPACE_OWNER"]);
});

test("M4: kegagalan audit menggagalkan workspace.create dan rollback", async () => {
  const tenant = await seedTenant(db);
  const before = await db.workspace.count();
  await assert.rejects(
    () =>
      failAuditWrites(() =>
        createWorkspace({ userId: tenant.ownerUserId, name: "Audit Gagal" }),
      ),
    /audit injected failure/i,
  );
  assert.equal(await db.workspace.count(), before);
});

test("M4: kegagalan audit menggagalkan role change dan rollback", async () => {
  const tenant = await seedTenant(db);
  const ctx = await ctxFor(tenant.tenantId, tenant.ownerUserId, tenant.ownerMemberId);
  const target = await seedMember(db, tenant.tenantId, tenant.roles.VIEWER);
  await assert.rejects(
    () =>
      failAuditWrites(() =>
        changeMemberRole({
          ctx,
          workspaceId: tenant.tenantId,
          memberId: target.memberId,
          role: "ANALYST",
        }),
      ),
    /audit injected failure/i,
  );
  assert.deepEqual(
    await db.memberRole
      .findMany({ where: { memberId: target.memberId } })
      .then((rows) => rows.map((row) => row.roleId)),
    [tenant.roles.VIEWER],
  );
});

test("M4: kegagalan audit menggagalkan ownership transfer dan rollback", async () => {
  const tenant = await seedTenant(db);
  const ctx = await ctxFor(tenant.tenantId, tenant.ownerUserId, tenant.ownerMemberId);
  const target = await seedMember(db, tenant.tenantId, tenant.roles.VIEWER);
  await assert.rejects(
    () =>
      failAuditWrites(() =>
        transferOwnership({
          ctx,
          workspaceId: tenant.tenantId,
          targetMemberId: target.memberId,
        }),
      ),
    /audit injected failure/i,
  );
  const owners = await db.memberRole.findMany({
    where: { tenantId: tenant.tenantId, roleId: tenant.roles.WORKSPACE_OWNER },
  });
  assert.deepEqual(owners.map((row) => row.memberId), [tenant.ownerMemberId]);
  assert.deepEqual(
    await db.memberRole
      .findMany({ where: { memberId: target.memberId } })
      .then((rows) => rows.map((row) => row.roleId)),
    [tenant.roles.VIEWER],
  );
});

test("M7: respons undangan produksi tidak memuat token; echo dev harus opt-in", () => {
  const result = {
    invitationId: "00000000-0000-4000-8000-000000000001",
    email: "x@example.com",
    roleKey: "VIEWER" as const,
    expiresAt: new Date("2026-01-01T00:00:00Z"),
    token: "token-mentah-undangan",
  };
  const production = invitationResponse(result, { production: true });
  assert.equal("token" in production, false);
  assert.equal(JSON.stringify(production).includes(result.token), false);

  const dev = invitationResponse(result, { production: false, echoDevToken: true });
  assert.equal(dev.token, result.token);
  assert.equal(dev.devTokenEcho, true);
});

test("S1-D1: admin tidak dapat memberikan ownership lewat role change", async () => {
  const tenant = await seedTenant(db);
  const admin = await seedMember(db, tenant.tenantId, tenant.roles.WORKSPACE_ADMIN);
  const ctx = await ctxFor(tenant.tenantId, admin.userId, admin.memberId);
  const target = await seedMember(db, tenant.tenantId, tenant.roles.VIEWER);

  await assert.rejects(
    () =>
      changeMemberRole({
        ctx,
        workspaceId: tenant.tenantId,
        memberId: target.memberId,
        role: "WORKSPACE_OWNER",
      }),
    (error: unknown) =>
      error instanceof HttpError &&
      error.status === 403 &&
      error.code === "OWNERSHIP_TRANSFER_REQUIRED",
  );

  const assignments = await db.memberRole.findMany({ where: { memberId: target.memberId } });
  assert.deepEqual(assignments.map((row) => row.roleId), [tenant.roles.VIEWER]);
  assert.equal(
    await db.memberRole.count({
      where: { tenantId: tenant.tenantId, roleId: tenant.roles.WORKSPACE_OWNER },
    }),
    1,
  );
});

test("S1-D2: admin tidak dapat memberi role setara atau mengubah admin/owner", async () => {
  const tenant = await seedTenant(db);
  const admin = await seedMember(db, tenant.tenantId, tenant.roles.WORKSPACE_ADMIN);
  const peer = await seedMember(db, tenant.tenantId, tenant.roles.WORKSPACE_ADMIN);
  const target = await seedMember(db, tenant.tenantId, tenant.roles.VIEWER);
  const ctx = await ctxFor(tenant.tenantId, admin.userId, admin.memberId);

  // Admin vs admin (target setara) dan pemberian role admin: pelanggaran hierarki.
  for (const [memberId, role] of [
    [peer.memberId, "VIEWER"],
    [target.memberId, "WORKSPACE_ADMIN"],
  ] as const) {
    await assert.rejects(
      () => changeMemberRole({ ctx, workspaceId: tenant.tenantId, memberId, role }),
      (error: unknown) =>
        error instanceof HttpError &&
        error.status === 403 &&
        error.code === "ROLE_HIERARCHY_VIOLATION",
    );
  }

  // Target owner terakhir: guard last-owner dievaluasi lebih dulu (409).
  // Ini tetap penolakan; kode spesifiknya diverifikasi terpisah di S1-8.
  await assert.rejects(
    () =>
      changeMemberRole({
        ctx,
        workspaceId: tenant.tenantId,
        memberId: tenant.ownerMemberId,
        role: "VIEWER",
      }),
    (error: unknown) =>
      error instanceof HttpError &&
      error.status === 409 &&
      error.code === "LAST_OWNER_PROTECTED",
  );
});

test("S1-D3: admin tetap dapat memberi role di bawah peringkatnya (regression)", async () => {
  const tenant = await seedTenant(db);
  const admin = await seedMember(db, tenant.tenantId, tenant.roles.WORKSPACE_ADMIN);
  const target = await seedMember(db, tenant.tenantId, tenant.roles.VIEWER);
  const ctx = await ctxFor(tenant.tenantId, admin.userId, admin.memberId);

  const result = await changeMemberRole({
    ctx,
    workspaceId: tenant.tenantId,
    memberId: target.memberId,
    role: "ANALYST",
  });
  assert.equal(result.changed, true);

  const assignment = await db.memberRole.findFirst({ where: { memberId: target.memberId } });
  assert.equal(assignment?.roleId, tenant.roles.ANALYST);
  const audit = await db.auditLog.findFirst({ where: { action: "role.change", resourceId: target.memberId } });
  assert.ok(audit);
});

test("S1-D4: invitation tidak dapat membawa owner atau role setara aktor", async () => {
  const tenant = await seedTenant(db);
  const admin = await seedMember(db, tenant.tenantId, tenant.roles.WORKSPACE_ADMIN);
  const ctx = await ctxFor(tenant.tenantId, admin.userId, admin.memberId);
  const before = await db.workspaceInvitation.count();

  for (const [email, role, code] of [
    ["owner-invite@example.com", "WORKSPACE_OWNER", "OWNERSHIP_TRANSFER_REQUIRED"],
    ["admin-invite@example.com", "WORKSPACE_ADMIN", "ROLE_HIERARCHY_VIOLATION"],
  ] as const) {
    await assert.rejects(
      () => inviteMember({ ctx, workspaceId: tenant.tenantId, email, role }),
      (error: unknown) =>
        error instanceof HttpError && error.status === 403 && error.code === code,
    );
  }
  assert.equal(await db.workspaceInvitation.count(), before);

  const allowed = await inviteMember({
    ctx,
    workspaceId: tenant.tenantId,
    email: "viewer-invite@example.com",
    role: "VIEWER",
  });
  assert.equal(allowed.roleKey, "VIEWER");
});

test("S1-D5: transfer ownership memindahkan tepat satu owner dan menulis audit", async () => {
  const tenant = await seedTenant(db);
  const ctx = await ctxFor(tenant.tenantId, tenant.ownerUserId, tenant.ownerMemberId);
  const target = await seedMember(db, tenant.tenantId, tenant.roles.VIEWER);

  const result = await transferOwnership({
    ctx,
    workspaceId: tenant.tenantId,
    targetMemberId: target.memberId,
    ip: "203.0.113.20",
  });

  assert.equal(result.fromMemberId, tenant.ownerMemberId);
  assert.equal(result.toMemberId, target.memberId);

  const owners = await db.memberRole.findMany({
    where: { tenantId: tenant.tenantId, roleId: tenant.roles.WORKSPACE_OWNER },
  });
  assert.deepEqual(owners.map((row) => row.memberId), [target.memberId]);
  const formerOwner = await db.memberRole.findMany({ where: { memberId: tenant.ownerMemberId } });
  assert.deepEqual(formerOwner.map((row) => row.roleId), [tenant.roles.WORKSPACE_ADMIN]);

  // Transfer mengubah privilege kedua pihak; sesi lama tidak boleh berlaku.
  assert.equal(await validateSession(tenant.ownerToken, { touch: false }), null);
  assert.equal(await validateSession(target.token, { touch: false }), null);

  const audit = await db.auditLog.findFirst({
    where: { action: "ownership.transfer", resourceId: target.memberId },
  });
  assert.ok(audit);
  assert.equal(audit?.actorUserId, tenant.ownerUserId);
  assert.equal(audit?.ipHash?.length, 32);
  const metadata = audit?.metadata as { fromMemberId?: string; toMemberId?: string } | null;
  assert.equal(metadata?.fromMemberId, tenant.ownerMemberId);
  assert.equal(metadata?.toMemberId, target.memberId);

  const serialized = JSON.stringify(audit?.metadata);
  for (const forbidden of ["token", "hash", "password", "secret"]) {
    assert.equal(serialized.toLowerCase().includes(forbidden), false, `audit memuat ${forbidden}`);
  }
});

test("S1-D6: transfer oleh non-owner, self, nonaktif, atau owner lain ditolak", async () => {
  const tenant = await seedTenant(db);
  const ownerCtx = await ctxFor(tenant.tenantId, tenant.ownerUserId, tenant.ownerMemberId);
  const admin = await seedMember(db, tenant.tenantId, tenant.roles.WORKSPACE_ADMIN);
  const adminCtx = await ctxFor(tenant.tenantId, admin.userId, admin.memberId);
  const target = await seedMember(db, tenant.tenantId, tenant.roles.VIEWER);

  await assert.rejects(
    () =>
      transferOwnership({
        ctx: adminCtx,
        workspaceId: tenant.tenantId,
        targetMemberId: target.memberId,
      }),
    (error: unknown) => error instanceof HttpError && error.status === 403,
  );

  await assert.rejects(
    () =>
      transferOwnership({
        ctx: ownerCtx,
        workspaceId: tenant.tenantId,
        targetMemberId: tenant.ownerMemberId,
      }),
    (error: unknown) => error instanceof HttpError && error.status === 400,
  );

  await db.workspaceMember.update({
    where: { id: target.memberId },
    data: { status: "INACTIVE" },
  });
  await assert.rejects(
    () =>
      transferOwnership({
        ctx: ownerCtx,
        workspaceId: tenant.tenantId,
        targetMemberId: target.memberId,
      }),
    (error: unknown) => error instanceof HttpError && error.status === 404,
  );

  const secondOwner = await seedMember(db, tenant.tenantId, tenant.roles.WORKSPACE_OWNER);
  await assert.rejects(
    () =>
      transferOwnership({
        ctx: ownerCtx,
        workspaceId: tenant.tenantId,
        targetMemberId: secondOwner.memberId,
      }),
    (error: unknown) =>
      error instanceof HttpError && error.status === 409 && error.code === "ALREADY_OWNER",
  );
});

test("S1-D7: dua transfer bersamaan tidak boleh menghasilkan dua owner", async () => {
  const tenant = await seedTenant(db);
  const ctx = await ctxFor(tenant.tenantId, tenant.ownerUserId, tenant.ownerMemberId);
  const first = await seedMember(db, tenant.tenantId, tenant.roles.VIEWER);
  const second = await seedMember(db, tenant.tenantId, tenant.roles.VIEWER);

  const settled = await Promise.allSettled([
    transferOwnership({
      ctx,
      workspaceId: tenant.tenantId,
      targetMemberId: first.memberId,
    }),
    transferOwnership({
      ctx,
      workspaceId: tenant.tenantId,
      targetMemberId: second.memberId,
    }),
  ]);

  const owners = await db.memberRole.findMany({
    where: { tenantId: tenant.tenantId, roleId: tenant.roles.WORKSPACE_OWNER },
  });
  assert.equal(owners.length, 1);

  const fulfilled = settled.filter((entry) => entry.status === "fulfilled");
  const rejected = settled.filter((entry) => entry.status === "rejected");
  assert.equal(fulfilled.length, 1);
  assert.equal(rejected.length, 1);
  const reason = rejected[0]?.status === "rejected" ? rejected[0].reason : undefined;
  assert.ok(reason instanceof HttpError);
  assert.equal(reason.code, "OWNERSHIP_CHANGED");
});

test("S1-D8: transfer lintas tenant ditolak dan tidak mengubah assignment", async () => {
  const a = await seedTenant(db, { name: "Transfer A" });
  const b = await seedTenant(db, { name: "Transfer B" });
  const ctxA = await ctxFor(a.tenantId, a.ownerUserId, a.ownerMemberId);
  const targetB = await seedMember(db, b.tenantId, b.roles.VIEWER);

  await assert.rejects(
    () =>
      transferOwnership({
        ctx: ctxA,
        workspaceId: b.tenantId,
        targetMemberId: targetB.memberId,
      }),
    (error: unknown) =>
      error instanceof HttpError && error.status === 404 && error.code === "WORKSPACE_NOT_FOUND",
  );

  await assert.rejects(
    () =>
      transferOwnership({
        ctx: ctxA,
        workspaceId: a.tenantId,
        targetMemberId: targetB.memberId,
      }),
    (error: unknown) =>
      error instanceof HttpError && error.status === 404 && error.code === "MEMBER_NOT_FOUND",
  );

  assert.deepEqual(
    await db.memberRole.findMany({ where: { memberId: targetB.memberId } }).then((rows) => rows.map((row) => row.roleId)),
    [b.roles.VIEWER],
  );
  assert.equal(
    await db.memberRole.count({
      where: { tenantId: a.tenantId, roleId: a.roles.WORKSPACE_OWNER },
    }),
    1,
  );
});

test("S1-D9: kegagalan di tengah transaksi transfer rollback total", async () => {
  const tenant = await seedTenant(db);
  const ctx = await ctxFor(tenant.tenantId, tenant.ownerUserId, tenant.ownerMemberId);
  const target = await seedMember(db, tenant.tenantId, tenant.roles.VIEWER);

  await assert.rejects(
    () =>
      withTenant(ctx, (scoped) =>
        scoped.$transaction(async (tx) => {
          await tx.memberRole.deleteMany({
            where: { tenantId: tenant.tenantId, memberId: target.memberId },
          });
          await tx.memberRole.create({
            data: {
              tenantId: tenant.tenantId,
              memberId: target.memberId,
              roleId: tenant.roles.WORKSPACE_OWNER,
            },
          });
          throw new Error("injected failure after writes");
        }),
      ),
    /injected failure/,
  );

  const targetRoles = await db.memberRole.findMany({ where: { memberId: target.memberId } });
  assert.deepEqual(targetRoles.map((row) => row.roleId), [tenant.roles.VIEWER]);
  const owners = await db.memberRole.findMany({
    where: { tenantId: tenant.tenantId, roleId: tenant.roles.WORKSPACE_OWNER },
  });
  assert.deepEqual(owners.map((row) => row.memberId), [tenant.ownerMemberId]);
});

test("S1-D10: PATCH role dan transfer ke target yang sama tetap tepat satu owner", async () => {
  const iterations = 50;
  let patchSucceeded = 0;
  let patchRejected = 0;

  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const tenant = await seedTenant(db);
    const admin = await seedMember(db, tenant.tenantId, tenant.roles.WORKSPACE_ADMIN);
    const target = await seedMember(db, tenant.tenantId, tenant.roles.VIEWER);
    const adminCtx = await ctxFor(tenant.tenantId, admin.userId, admin.memberId);
    const ownerCtx = await ctxFor(tenant.tenantId, tenant.ownerUserId, tenant.ownerMemberId);

    const [patch, transfer] = await Promise.allSettled([
      changeMemberRole({
        ctx: adminCtx,
        workspaceId: tenant.tenantId,
        memberId: target.memberId,
        role: "ANALYST",
      }),
      transferOwnership({
        ctx: ownerCtx,
        workspaceId: tenant.tenantId,
        targetMemberId: target.memberId,
      }),
    ]);

    if (transfer.status !== "fulfilled") {
      throw new Error(`S1-D10 iterasi ${iteration}: transfer gagal: ${String(transfer.reason)}`);
    }

    const owners = await db.memberRole.findMany({
      where: { tenantId: tenant.tenantId, roleId: tenant.roles.WORKSPACE_OWNER },
    });
    assert.equal(owners.length, 1, `S1-D10 iterasi ${iteration}: owner count ${owners.length}`);
    assert.equal(owners[0]?.memberId, target.memberId, `S1-D10 iterasi ${iteration}: owner bukan target`);

    const targetRoles = await db.memberRole.findMany({ where: { memberId: target.memberId } });
    assert.deepEqual(
      targetRoles.map((row) => row.roleId),
      [tenant.roles.WORKSPACE_OWNER],
      `S1-D10 iterasi ${iteration}: target bukan satu-satunya owner`,
    );
    const formerOwnerRoles = await db.memberRole.findMany({
      where: { memberId: tenant.ownerMemberId },
    });
    assert.deepEqual(
      formerOwnerRoles.map((row) => row.roleId),
      [tenant.roles.WORKSPACE_ADMIN],
      `S1-D10 iterasi ${iteration}: former owner bukan admin`,
    );

    if (patch.status === "fulfilled") {
      patchSucceeded += 1;
      assert.equal(patch.value.changed, true);
    } else {
      patchRejected += 1;
      assert.ok(patch.reason instanceof HttpError);
      assert.ok(
        patch.reason.status === 403 || patch.reason.status === 409,
        `S1-D10 iterasi ${iteration}: status PATCH ${patch.reason.status}`,
      );
    }
  }

  assert.equal(patchSucceeded + patchRejected, iterations);
  console.log(
    `S1-D10 iterations=${iterations} patch_success=${patchSucceeded} patch_conflict=${patchRejected}`,
  );
});

test("S1-D11: PATCH role dan transfer ke target berbeda tetap konsisten", async () => {
  const iterations = 50;

  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const tenant = await seedTenant(db);
    const admin = await seedMember(db, tenant.tenantId, tenant.roles.WORKSPACE_ADMIN);
    const patchTarget = await seedMember(db, tenant.tenantId, tenant.roles.VIEWER);
    const transferTarget = await seedMember(db, tenant.tenantId, tenant.roles.VIEWER);
    const adminCtx = await ctxFor(tenant.tenantId, admin.userId, admin.memberId);
    const ownerCtx = await ctxFor(tenant.tenantId, tenant.ownerUserId, tenant.ownerMemberId);

    const [patch, transfer] = await Promise.allSettled([
      changeMemberRole({
        ctx: adminCtx,
        workspaceId: tenant.tenantId,
        memberId: patchTarget.memberId,
        role: "ANALYST",
      }),
      transferOwnership({
        ctx: ownerCtx,
        workspaceId: tenant.tenantId,
        targetMemberId: transferTarget.memberId,
      }),
    ]);

    assert.equal(patch.status, "fulfilled", `S1-D11 iterasi ${iteration}: PATCH gagal`);
    assert.equal(transfer.status, "fulfilled", `S1-D11 iterasi ${iteration}: transfer gagal`);

    const owners = await db.memberRole.findMany({
      where: { tenantId: tenant.tenantId, roleId: tenant.roles.WORKSPACE_OWNER },
    });
    assert.equal(owners.length, 1, `S1-D11 iterasi ${iteration}: owner count ${owners.length}`);
    assert.equal(owners[0]?.memberId, transferTarget.memberId);

    const patchRoles = await db.memberRole.findMany({ where: { memberId: patchTarget.memberId } });
    assert.deepEqual(patchRoles.map((row) => row.roleId), [tenant.roles.ANALYST]);
    const transferRoles = await db.memberRole.findMany({
      where: { memberId: transferTarget.memberId },
    });
    assert.deepEqual(transferRoles.map((row) => row.roleId), [tenant.roles.WORKSPACE_OWNER]);
  }

  console.log(`S1-D11 iterations=${iterations} patch_success=${iterations} transfer_success=${iterations}`);
});

test("S1-D12: dua transfer bersamaan tetap tepat satu owner selama 50 iterasi", async () => {
  const iterations = 50;
  let oneSuccess = 0;
  let oneConflict = 0;

  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const tenant = await seedTenant(db);
    const ctx = await ctxFor(tenant.tenantId, tenant.ownerUserId, tenant.ownerMemberId);
    const first = await seedMember(db, tenant.tenantId, tenant.roles.VIEWER);
    const second = await seedMember(db, tenant.tenantId, tenant.roles.VIEWER);

    const settled = await Promise.allSettled([
      transferOwnership({
        ctx,
        workspaceId: tenant.tenantId,
        targetMemberId: first.memberId,
      }),
      transferOwnership({
        ctx,
        workspaceId: tenant.tenantId,
        targetMemberId: second.memberId,
      }),
    ]);

    const fulfilled = settled.filter((entry) => entry.status === "fulfilled");
    const rejected = settled.filter((entry) => entry.status === "rejected");
    assert.equal(fulfilled.length, 1, `S1-D12 iterasi ${iteration}: fulfilled ${fulfilled.length}`);
    assert.equal(rejected.length, 1, `S1-D12 iterasi ${iteration}: rejected ${rejected.length}`);
    const reason = rejected[0]?.status === "rejected" ? rejected[0].reason : undefined;
    assert.ok(reason instanceof HttpError, `S1-D12 iterasi ${iteration}: error bukan HttpError`);
    assert.equal(reason.code, "OWNERSHIP_CHANGED");

    const owners = await db.memberRole.findMany({
      where: { tenantId: tenant.tenantId, roleId: tenant.roles.WORKSPACE_OWNER },
    });
    assert.equal(owners.length, 1, `S1-D12 iterasi ${iteration}: owner count ${owners.length}`);
    oneSuccess += 1;
    oneConflict += 1;
  }

  assert.equal(oneSuccess, iterations);
  assert.equal(oneConflict, iterations);
  console.log(`S1-D12 iterations=${iterations} one_success=${oneSuccess} one_conflict=${oneConflict}`);
});

test("S1-D13: last owner tetap terlindungi tanpa perubahan assignment", async () => {
  const tenant = await seedTenant(db);
  const admin = await seedMember(db, tenant.tenantId, tenant.roles.WORKSPACE_ADMIN);
  const adminCtx = await ctxFor(tenant.tenantId, admin.userId, admin.memberId);
  const ownerCtx = await ctxFor(tenant.tenantId, tenant.ownerUserId, tenant.ownerMemberId);

  const rolesBefore = await db.memberRole.findMany({
    where: { tenantId: tenant.tenantId },
    orderBy: [{ memberId: "asc" }, { roleId: "asc" }],
  });

  await assert.rejects(
    () =>
      changeMemberRole({
        ctx: adminCtx,
        workspaceId: tenant.tenantId,
        memberId: tenant.ownerMemberId,
        role: "VIEWER",
      }),
    (error: unknown) =>
      error instanceof HttpError &&
      error.status === 409 &&
      error.code === "LAST_OWNER_PROTECTED",
  );

  await assert.rejects(
    () =>
      transferOwnership({
        ctx: ownerCtx,
        workspaceId: tenant.tenantId,
        targetMemberId: tenant.ownerMemberId,
      }),
    (error: unknown) =>
      error instanceof HttpError &&
      error.status === 400 &&
      error.code === "SELF_OWNERSHIP_TRANSFER",
  );

  const rolesAfter = await db.memberRole.findMany({
    where: { tenantId: tenant.tenantId },
    orderBy: [{ memberId: "asc" }, { roleId: "asc" }],
  });
  assert.deepEqual(rolesAfter, rolesBefore);
  const owners = await db.memberRole.findMany({
    where: { tenantId: tenant.tenantId, roleId: tenant.roles.WORKSPACE_OWNER },
  });
  assert.deepEqual(owners.map((row) => row.memberId), [tenant.ownerMemberId]);
});

test("S1-D14: kegagalan setelah penulisan ownership rollback total", async () => {
  const tenant = await seedTenant(db);
  const ctx = await ctxFor(tenant.tenantId, tenant.ownerUserId, tenant.ownerMemberId);
  const target = await seedMember(db, tenant.tenantId, tenant.roles.VIEWER);

  await assert.rejects(
    () =>
      withTenant(ctx, (scoped) =>
        scoped.$transaction(async (tx) => {
          const locked = await tx.$queryRaw<Array<{ id: string }>>`
            SELECT id FROM workspaces WHERE id = ${ctx.tenantId} FOR UPDATE
          `;
          if (locked.length !== 1) throw new Error("workspace lock gagal");
          await tx.memberRole.deleteMany({
            where: { tenantId: ctx.tenantId, memberId: target.memberId },
          });
          await tx.memberRole.create({
            data: {
              tenantId: ctx.tenantId,
              memberId: target.memberId,
              roleId: tenant.roles.WORKSPACE_OWNER,
            },
          });
          await tx.memberRole.deleteMany({
            where: { tenantId: ctx.tenantId, memberId: ctx.memberId },
          });
          await tx.memberRole.create({
            data: {
              tenantId: ctx.tenantId,
              memberId: ctx.memberId,
              roleId: tenant.roles.WORKSPACE_ADMIN,
            },
          });
          throw new Error("injected failure after ownership writes");
        }),
      ),
    /injected failure after ownership writes/,
  );

  const targetRoles = await db.memberRole.findMany({ where: { memberId: target.memberId } });
  assert.deepEqual(targetRoles.map((row) => row.roleId), [tenant.roles.VIEWER]);
  const actorRoles = await db.memberRole.findMany({ where: { memberId: ctx.memberId } });
  assert.deepEqual(actorRoles.map((row) => row.roleId), [tenant.roles.WORKSPACE_OWNER]);
  const owners = await db.memberRole.findMany({
    where: { tenantId: tenant.tenantId, roleId: tenant.roles.WORKSPACE_OWNER },
  });
  assert.deepEqual(owners.map((row) => row.memberId), [tenant.ownerMemberId]);
});

test("S1-D15: PATCH role sama pada target Owner tetap ditolak", async () => {
  const tenant = await seedTenant(db);
  const secondOwner = await seedMember(db, tenant.tenantId, tenant.roles.WORKSPACE_OWNER);
  const ctx = await ctxFor(tenant.tenantId, tenant.ownerUserId, tenant.ownerMemberId);
  const rolesBefore = await db.memberRole.findMany({
    where: { memberId: secondOwner.memberId },
  });

  await assert.rejects(
    () =>
      changeMemberRole({
        ctx,
        workspaceId: tenant.tenantId,
        memberId: secondOwner.memberId,
        role: "WORKSPACE_OWNER",
      }),
    (error: unknown) =>
      error instanceof HttpError &&
      error.status === 403 &&
      error.code === "OWNERSHIP_TRANSFER_REQUIRED",
  );

  const rolesAfter = await db.memberRole.findMany({
    where: { memberId: secondOwner.memberId },
  });
  assert.deepEqual(
    rolesAfter.map((row) => row.roleId),
    rolesBefore.map((row) => row.roleId),
  );
  assert.equal(
    await db.memberRole.count({
      where: { tenantId: tenant.tenantId, roleId: tenant.roles.WORKSPACE_OWNER },
    }),
    2,
  );
});

test("S1-D16: no-op role biasa tetap mengikuti kebijakan aktor", async () => {
  const tenant = await seedTenant(db);
  const admin = await seedMember(db, tenant.tenantId, tenant.roles.WORKSPACE_ADMIN);
  const peer = await seedMember(db, tenant.tenantId, tenant.roles.WORKSPACE_ADMIN);
  const target = await seedMember(db, tenant.tenantId, tenant.roles.VIEWER);
  const viewer = await seedMember(db, tenant.tenantId, tenant.roles.VIEWER);
  const adminCtx = await ctxFor(tenant.tenantId, admin.userId, admin.memberId);
  const viewerCtx = await ctxFor(tenant.tenantId, viewer.userId, viewer.memberId);

  await assert.rejects(
    () =>
      changeMemberRole({
        ctx: viewerCtx,
        workspaceId: tenant.tenantId,
        memberId: target.memberId,
        role: "VIEWER",
      }),
    (error: unknown) =>
      error instanceof HttpError &&
      error.status === 403 &&
      error.code === "FORBIDDEN",
  );

  await assert.rejects(
    () =>
      changeMemberRole({
        ctx: adminCtx,
        workspaceId: tenant.tenantId,
        memberId: peer.memberId,
        role: "WORKSPACE_ADMIN",
      }),
    (error: unknown) =>
      error instanceof HttpError &&
      error.status === 403 &&
      error.code === "ROLE_HIERARCHY_VIOLATION",
  );

  const result = await changeMemberRole({
    ctx: adminCtx,
    workspaceId: tenant.tenantId,
    memberId: target.memberId,
    role: "VIEWER",
  });
  assert.equal(result.changed, false);
  assert.deepEqual(
    await db.memberRole
      .findMany({ where: { memberId: target.memberId } })
      .then((rows) => rows.map((row) => row.roleId)),
    [tenant.roles.VIEWER],
  );
  assert.deepEqual(
    await db.memberRole
      .findMany({ where: { memberId: peer.memberId } })
      .then((rows) => rows.map((row) => row.roleId)),
    [tenant.roles.WORKSPACE_ADMIN],
  );
});
