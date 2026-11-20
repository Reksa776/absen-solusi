import assert from "node:assert/strict";
import test, { after, before } from "node:test";

import { createTenantContext, resolveMemberPermissions, type PrismaClient } from "@absensi/database";

import { loginWithPassword, registerBootstrap } from "./users.js";
import { changeMemberRole, createWorkspace, inviteMember } from "./workspaces.js";
import { MemoryRateLimiter } from "./rate-limit.js";
import { hashPassword } from "./password.js";
import { adminClient, resetDatabase, seedMember, seedTenant } from "./test-support.js";

let db: PrismaClient = null as unknown as PrismaClient;

before(async () => {
  db = adminClient();
  await resetDatabase(db);
  process.env.ALLOW_REGISTRATION = "true";
});

after(async () => {
  if (!db) return;
  await resetDatabase(db);
  await db.$disconnect();
});

test("E1: lima aksi audit wajib punya tenant_id, actor, ip_hash 32 byte, dan metadata tanpa token/hash", async () => {
  const password = "password-audit-e1";
  const bootstrap = await registerBootstrap({
    email: "audit-e1@example.com",
    password,
    name: "Audit E1",
    ip: "203.0.113.20",
  });

  await loginWithPassword({
    email: "audit-e1@example.com",
    password,
    ip: "203.0.113.21",
    limiter: new MemoryRateLimiter(),
  });

  const workspace = await createWorkspace({
    userId: bootstrap.user.id,
    name: "Audit Workspace",
    ip: "203.0.113.22",
  });

  const perms = await resolveMemberPermissions(db, workspace.workspace.id, workspace.memberId);
  const ctx = createTenantContext({
    tenantId: workspace.workspace.id,
    userId: bootstrap.user.id,
    memberId: workspace.memberId,
    ...perms,
  });

  const invitation = await inviteMember({
    ctx,
    workspaceId: ctx.tenantId,
    email: "diundang@example.com",
    role: "VIEWER",
    ip: "203.0.113.23",
  });

  const target = await seedMember(db, ctx.tenantId, workspace.roles.VIEWER);
  await changeMemberRole({
    ctx,
    workspaceId: ctx.tenantId,
    memberId: target.memberId,
    role: "ANALYST",
    ip: "203.0.113.24",
  });

  const required = [
    "auth.register_bootstrap",
    "auth.login",
    "workspace.create",
    "member.invite",
    "role.change",
  ];
  const rows = await db.auditLog.findMany();
  for (const action of required) {
    const row = rows.find((candidate) => candidate.action === action);
    assert.ok(row, `audit ${action} tidak ditemukan`);
    assert.ok(row?.tenantId, `audit ${action} tanpa tenant_id`);
    assert.ok(row?.actorUserId, `audit ${action} tanpa actor_user_id`);
    assert.ok(row?.actorMemberId, `audit ${action} tanpa actor_member_id`);
    assert.equal(row?.ipHash?.length, 32, `audit ${action} ip_hash bukan 32 byte`);
    const serialized = JSON.stringify(row?.metadata ?? {});
    for (const secret of [invitation.token, password, "token", "tokenHash"]) {
      assert.equal(
        serialized.toLowerCase().includes(secret.toLowerCase()),
        false,
        `audit ${action} membocorkan ${secret}`,
      );
    }
  }

  // Metadata role.change memuat from/to, bukan hash atau token.
  const roleAudit = rows.find((row) => row.action === "role.change");
  const metadata = roleAudit?.metadata as { from?: string[]; to?: string } | null;
  assert.deepEqual(metadata?.from, [workspace.roles.VIEWER]);
  assert.equal(metadata?.to, "ANALYST");
});

test("E2: login gagal tidak menulis audit dan tidak menyimpan password", async () => {
  await resetDatabase(db);
  const passwordHash = await hashPassword("password-benar-e2");
  const tenant = await seedTenant(db, { passwordHash });
  assert.ok(tenant.tenantId);
  assert.ok(passwordHash.length > 0);

  const before = await db.auditLog.count({ where: { action: "auth.login" } });
  await assert.rejects(() =>
    loginWithPassword({
      email: tenant.ownerEmail,
      password: "password-salah-e2",
      ip: "203.0.113.31",
      limiter: new MemoryRateLimiter(),
    }),
  );
  assert.equal(await db.auditLog.count({ where: { action: "auth.login" } }), before);
  const rows = await db.auditLog.findMany();
  for (const row of rows) {
    assert.equal(JSON.stringify(row.metadata ?? {}).includes("password-salah-e2"), false);
  }
});
