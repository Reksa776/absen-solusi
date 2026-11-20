import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test, { after, before } from "node:test";

import type { PrismaClient } from "@absensi/database";

import { HttpError } from "./http.js";
import { validateSession } from "./session.js";
import { adminClient, resetDatabase, seedTenant } from "./test-support.js";
import { createWorkspace } from "./workspaces.js";
import { switchActiveWorkspace } from "./workspace-switch.js";

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

test("B6-1: switch hanya ke workspace milik user dan memperbarui session + audit", async () => {
  const a = await seedTenant(db, { name: "Switch A" });
  const b = await createWorkspace({ userId: a.ownerUserId, name: "Switch B" });
  const session = await validateSession(a.ownerToken, { touch: false });
  assert.ok(session);

  const result = await switchActiveWorkspace({
    sessionId: session.id,
    userId: a.ownerUserId,
    currentTenantId: a.tenantId,
    workspaceId: b.workspace.id,
    ip: "203.0.113.80",
  });

  assert.equal(result.activeTenantId, b.workspace.id);
  assert.equal(result.workspace.name, "Switch B");
  assert.deepEqual(result.roleKeys, ["WORKSPACE_OWNER"]);
  const updated = await validateSession(a.ownerToken, { touch: false });
  assert.equal(updated?.activeTenantId, b.workspace.id);

  const audit = await db.auditLog.findFirst({
    where: { action: "workspace.switch_tenant", tenantId: b.workspace.id },
  });
  assert.ok(audit);
  assert.equal(audit?.actorUserId, a.ownerUserId);
  assert.equal(audit?.actorMemberId, b.memberId);
  assert.equal(audit?.ipHash?.length, 32);
  const metadata = audit?.metadata as { fromTenantId?: string; toTenantId?: string } | null;
  assert.equal(metadata?.fromTenantId, a.tenantId);
  assert.equal(metadata?.toTenantId, b.workspace.id);
});

test("B6-2: workspace asing/tidak ada ditolak 403 dan session tidak berubah", async () => {
  const a = await seedTenant(db, { name: "Switch Foreign" });
  const session = await validateSession(a.ownerToken, { touch: false });
  assert.ok(session);

  await assert.rejects(
    () =>
      switchActiveWorkspace({
        sessionId: session.id,
        userId: a.ownerUserId,
        currentTenantId: a.tenantId,
        workspaceId: randomUUID(),
      }),
    (error: unknown) =>
      error instanceof HttpError && error.status === 403 && error.code === "WORKSPACE_FORBIDDEN",
  );

  const unchanged = await validateSession(a.ownerToken, { touch: false });
  assert.equal(unchanged?.activeTenantId, a.tenantId);
});
