import assert from "node:assert/strict";
import test, { after, before } from "node:test";

import {
  createTenantContext,
  resolveMemberPermissions,
  writeAudit,
  type PrismaClient,
} from "@absensi/database";

import { listAuditLogs } from "./audit-view.js";
import { HttpError } from "./http.js";
import { adminClient, resetDatabase, seedTenant } from "./test-support.js";

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
  const access = await resolveMemberPermissions(db, tenantId, memberId);
  return createTenantContext({ tenantId, userId, memberId, ...access });
}

test("B7-1: audit viewer hanya membaca tenant ctx dan mendukung filter action", async () => {
  const tenant = await seedTenant(db, { name: "Audit Viewer" });
  const ctx = await ctxFor(tenant.tenantId, tenant.ownerUserId, tenant.ownerMemberId);
  await writeAudit({
    tenantId: tenant.tenantId,
    actorType: "USER",
    actorUserId: tenant.ownerUserId,
    actorMemberId: tenant.ownerMemberId,
    action: "member.invite",
    resourceType: "member",
    metadata: { email: "a@example.com" },
  });
  await writeAudit({
    tenantId: tenant.tenantId,
    actorType: "USER",
    actorUserId: tenant.ownerUserId,
    actorMemberId: tenant.ownerMemberId,
    action: "workspace.switch_tenant",
    resourceType: "workspace",
  });

  const all = await listAuditLogs({ ctx, workspaceId: tenant.tenantId });
  assert.equal(all.pagination.total, 2);
  assert.equal(Object.hasOwn(all.logs[0] ?? {}, "tenantId"), false);
  const filtered = await listAuditLogs({
    ctx,
    workspaceId: tenant.tenantId,
    action: "member.invite",
  });
  assert.equal(filtered.logs.length, 1);
  assert.equal(filtered.logs[0]?.action, "member.invite");
});

test("B7-2: audit viewer workspace asing memberi 403 identik", async () => {
  const a = await seedTenant(db, { name: "Audit A" });
  const b = await seedTenant(db, { name: "Audit B" });
  const ctx = await ctxFor(a.tenantId, a.ownerUserId, a.ownerMemberId);

  await assert.rejects(
    () => listAuditLogs({ ctx, workspaceId: b.tenantId }),
    (error: unknown) =>
      error instanceof HttpError && error.status === 403 && error.code === "WORKSPACE_NOT_FOUND",
  );
});
