import assert from "node:assert/strict";
import test, { after, before } from "node:test";

import type { PrismaClient } from "@absensi/database";
import {
  ALL_PERMISSIONS,
  ROLE_KEYS,
  roleHasPermission,
  type PermissionKey,
  type RoleKey,
} from "@absensi/permissions";

import { HttpError, requirePermission } from "./http.js";
import { changeMemberRole } from "./workspaces.js";
import { bearerRequest, adminClient, resetDatabase, seedMember, seedTenant } from "./test-support.js";
import { createTenantContext } from "@absensi/database";
import { resolveMemberPermissions } from "@absensi/database";
import { createSession, validateSession } from "./session.js";

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

test("C1: matrix role × permission cocok dengan roleHasPermission", async () => {
  const tenant = await seedTenant(db);
  const sessions = new Map<RoleKey, { token: string; memberId: string }>();
  for (const roleKey of ROLE_KEYS) {
    const member = await seedMember(db, tenant.tenantId, tenant.roles[roleKey]);
    sessions.set(roleKey, { token: member.token, memberId: member.memberId });
  }

  let checked = 0;
  for (const roleKey of ROLE_KEYS) {
    const session = sessions.get(roleKey);
    assert.ok(session, `session untuk ${roleKey} harus ada`);
    for (const permission of ALL_PERMISSIONS) {
      const expected = roleHasPermission(roleKey, permission);
      let actual = true;
      try {
        await requirePermission(bearerRequest(session.token), permission);
      } catch (error) {
        if (error instanceof HttpError && error.status === 403) actual = false;
        else throw error;
      }
      assert.equal(
        actual,
        expected,
        `role ${roleKey} permission ${permission}: harap ${expected}, aktual ${actual}`,
      );
      checked += 1;
    }
  }
  assert.equal(checked, ROLE_KEYS.length * ALL_PERMISSIONS.length);
});

test("C2: role berubah langsung memengaruhi request berikutnya pada session yang sama", async () => {
  const tenant = await seedTenant(db);
  const viewer = await seedMember(db, tenant.tenantId, tenant.roles.VIEWER);

  await assert.rejects(
    () => requirePermission(bearerRequest(viewer.token), "member.manage"),
    (error: unknown) => error instanceof HttpError && error.status === 403,
  );

  const perms = await resolveMemberPermissions(db, tenant.tenantId, tenant.ownerMemberId);
  const actorCtx = createTenantContext({
    tenantId: tenant.tenantId,
    userId: tenant.ownerUserId,
    memberId: tenant.ownerMemberId,
    ...perms,
  });

  const result = await changeMemberRole({
    ctx: actorCtx,
    workspaceId: tenant.tenantId,
    memberId: viewer.memberId,
    role: "WORKSPACE_ADMIN",
  });
  assert.equal(result.changed, true);

  // Sesi lama target harus mati setelah privilege berubah; token baru dibuat
  // lewat login/session baru, bukan memakai token lama.
  assert.equal(await validateSession(viewer.token, { touch: false }), null);
  const fresh = await createSession({
    userId: viewer.userId,
    activeTenantId: tenant.tenantId,
  });
  const allowed = await requirePermission(bearerRequest(fresh.token), "member.manage");
  assert.equal(allowed.ctx.tenantId, tenant.tenantId);
  assert.equal(allowed.ctx.roleKeys.includes("WORKSPACE_ADMIN"), true);
});

test("C3: role change no-op tidak menulis audit", async () => {
  const tenant = await seedTenant(db);
  const perms = await resolveMemberPermissions(db, tenant.tenantId, tenant.ownerMemberId);
  const ctx = createTenantContext({
    tenantId: tenant.tenantId,
    userId: tenant.ownerUserId,
    memberId: tenant.ownerMemberId,
    ...perms,
  });
  const viewer = await seedMember(db, tenant.tenantId, tenant.roles.VIEWER);

  const before = await db.auditLog.count({ where: { action: "role.change" } });
  const result = await changeMemberRole({
    ctx,
    workspaceId: tenant.tenantId,
    memberId: viewer.memberId,
    role: "VIEWER",
  });
  const afterCount = await db.auditLog.count({ where: { action: "role.change" } });
  assert.equal(result.changed, false);
  assert.equal(afterCount, before);
});

test("C4: permission yang tidak ada di katalog tetap ditolak (fail-closed)", async () => {
  const tenant = await seedTenant(db);
  await assert.rejects(
    () => requirePermission(bearerRequest(tenant.ownerToken), "tidak.ada"),
    (error: unknown) => error instanceof HttpError && error.status === 403,
  );
});

test("C5: cookie mode tanpa CSRF pada request non-GET ditolak 403", async () => {
  const tenant = await seedTenant(db);
  const request = new Request("http://localhost/api/test", {
    method: "POST",
    headers: { cookie: `aos_session=${tenant.ownerToken}`, "content-type": "application/json" },
    body: "{}",
  });
  await assert.rejects(
    () => requirePermission(request, "workspace.read"),
    (error: unknown) => error instanceof HttpError && error.status === 403,
  );
});

void (undefined as PermissionKey | undefined);
