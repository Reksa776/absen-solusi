import assert from "node:assert/strict";
import test, { after, before } from "node:test";

import {
  createTenantContext,
  resolveMemberPermissions,
  retryAuditOutbox,
  type PrismaClient,
} from "@absensi/database";

import { HttpError } from "./http.js";
import { adminClient, resetDatabase, seedTenant } from "./test-support.js";
import { createWorkspace, inviteMember } from "./workspaces.js";

let db: PrismaClient = null as unknown as PrismaClient;

before(async () => {
  db = adminClient();
  await resetDatabase(db);
});

after(async () => {
  if (!db) return;
  await db.$executeRawUnsafe("DROP TRIGGER IF EXISTS test_fail_audit_insert");
  await resetDatabase(db);
  await db.$disconnect();
});

async function ctxFor(tenantId: string, userId: string, memberId: string) {
  const access = await resolveMemberPermissions(db, tenantId, memberId);
  return createTenantContext({ tenantId, userId, memberId, ...access });
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

test("B9-1: audit invite gagal masuk outbox lalu retry berhasil", async () => {
  const tenant = await seedTenant(db, { name: "Outbox Tenant" });
  const ctx = await ctxFor(tenant.tenantId, tenant.ownerUserId, tenant.ownerMemberId);

  await failAuditWrites(async () => {
    const invite = await inviteMember({
      ctx,
      workspaceId: tenant.tenantId,
      email: `outbox-${tenant.tenantId}@example.com`,
      role: "VIEWER",
    });
    assert.ok(invite.invitationId);
  });

  const pending = await db.backgroundJob.findMany({
    where: { tenantId: tenant.tenantId, type: "audit.outbox" },
  });
  assert.equal(pending.length, 1);
  assert.equal(await db.auditLog.count({ where: { tenantId: tenant.tenantId } }), 0);

  const retry = await retryAuditOutbox({ client: db });
  assert.deepEqual(retry, { attempted: 1, completed: 1, failed: 0 });
  assert.equal(
    await db.auditLog.count({ where: { tenantId: tenant.tenantId, action: "member.invite" } }),
    1,
  );
  const completed = await db.backgroundJob.findUnique({ where: { id: pending[0]?.id ?? "" } });
  assert.equal(completed?.status, "COMPLETED");
  assert.equal(completed?.attempts, 1);
});

test("B9-2: aksi berisiko workspace.create tetap rollback dan tidak memakai outbox", async () => {
  const tenant = await seedTenant(db, { name: "Outbox Risky" });
  const beforeWorkspaces = await db.workspace.count();
  await assert.rejects(
    () =>
      failAuditWrites(() =>
        createWorkspace({ userId: tenant.ownerUserId, name: "Harus Rollback" }),
      ),
    /audit injected failure/i,
  );
  assert.equal(await db.workspace.count(), beforeWorkspaces);
  assert.equal(
    await db.backgroundJob.count({
      where: { tenantId: tenant.tenantId, type: "audit.outbox" },
    }),
    0,
  );
  // Pastikan HttpError tetap tersedia sebagai kontrak error route.
  assert.equal(new HttpError(403, "FORBIDDEN", "x").status, 403);
});
