import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test, { after, before } from "node:test";

import {
  createTenantContext,
  resolveMemberPermissions,
  type PrismaClient,
} from "@absensi/database";

import { acceptInvitation, INVITATION_ACCEPT_ACTION } from "./invitations.js";
import { HttpError } from "./http.js";
import { createSession } from "./session.js";
import { adminClient, resetDatabase, seedTenant } from "./test-support.js";
import { inviteMember } from "./workspaces.js";

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

async function makeInvitation(email: string) {
  const tenant = await seedTenant(db);
  const ctx = await ctxFor(tenant.tenantId, tenant.ownerUserId, tenant.ownerMemberId);
  const invitation = await inviteMember({
    ctx,
    workspaceId: tenant.tenantId,
    email,
    role: "VIEWER",
    ip: "203.0.113.50",
  });
  return { tenant, invitation };
}

async function existingUser(email: string) {
  const userId = randomUUID();
  await db.user.create({
    data: { id: userId, email, passwordHash: "x", name: "Existing User" },
  });
  const { token } = await createSession({ userId, activeTenantId: null });
  return { userId, token };
}

test("B2-1: token valid untuk existing user membuat membership ACTIVE, role, dan audit", async () => {
  const email = `accept-${randomUUID()}@example.com`;
  const { tenant, invitation } = await makeInvitation(email);
  const user = await existingUser(email);

  const result = await acceptInvitation({
    token: invitation.token,
    authenticatedUserId: user.userId,
    ip: "203.0.113.51",
  });

  assert.equal(result.workspace.id, tenant.tenantId);
  assert.equal(result.memberId.length, 36);
  const member = await db.workspaceMember.findUnique({ where: { id: result.memberId } });
  assert.equal(member?.status, "ACTIVE");
  assert.equal(member?.userId, user.userId);
  assert.equal(member?.joinedAt instanceof Date, true);
  const role = await db.memberRole.findFirst({ where: { memberId: result.memberId } });
  assert.equal(role?.roleId, tenant.roles.VIEWER);
  const row = await db.workspaceInvitation.findUnique({ where: { id: invitation.invitationId } });
  assert.equal(row?.status, "ACCEPTED");
  assert.ok(row?.acceptedAt);

  const audit = await db.auditLog.findFirst({
    where: { action: INVITATION_ACCEPT_ACTION, resourceId: result.memberId },
  });
  assert.ok(audit);
  assert.equal(audit?.tenantId, tenant.tenantId);
  assert.equal(audit?.actorUserId, user.userId);
  assert.equal(audit?.actorMemberId, result.memberId);
  assert.equal(audit?.ipHash?.length, 32);
  const metadata = JSON.stringify(audit?.metadata);
  assert.equal(metadata.includes(invitation.token), false);
  assert.equal(metadata.includes(row?.tokenHash ?? "x"), false);
});

test("B2-2: token salah, expired, reused, dan email mismatch ditolak", async () => {
  const email = `accept-${randomUUID()}@example.com`;
  const { tenant, invitation } = await makeInvitation(email);

  await assert.rejects(
    () => acceptInvitation({ token: "wrong-token" }),
    (error: unknown) => error instanceof HttpError && error.status === 404,
  );

  await db.workspaceInvitation.update({
    where: { id: invitation.invitationId },
    data: { expiresAt: new Date(Date.now() - 1000) },
  });
  await assert.rejects(
    () => acceptInvitation({ token: invitation.token }),
    (error: unknown) =>
      error instanceof HttpError && error.status === 410 && error.code === "INVITATION_EXPIRED",
  );
  await db.workspaceInvitation.update({
    where: { id: invitation.invitationId },
    data: { expiresAt: new Date(Date.now() + 60_000) },
  });

  const user = await existingUser(email);
  await acceptInvitation({
    token: invitation.token,
    authenticatedUserId: user.userId,
  });
  await assert.rejects(
    () => acceptInvitation({ token: invitation.token, authenticatedUserId: user.userId }),
    (error: unknown) =>
      error instanceof HttpError && error.status === 409 && error.code === "INVITATION_USED",
  );

  const otherEmail = `other-${randomUUID()}@example.com`;
  const other = await existingUser(otherEmail);
  const second = await makeInvitation(`second-${randomUUID()}@example.com`);
  await assert.rejects(
    () => acceptInvitation({ token: second.invitation.token, authenticatedUserId: other.userId }),
    (error: unknown) =>
      error instanceof HttpError &&
      error.status === 403 &&
      error.code === "INVITATION_EMAIL_MISMATCH",
  );
  assert.equal(
    await db.workspaceMember.count({
      where: { tenantId: second.tenant.tenantId, userId: other.userId },
    }),
    0,
  );
  assert.equal(tenant.tenantId.length, 36);
});

test("B2-3: user baru dibuat dari token dengan name/password lalu membership ACTIVE", async () => {
  const email = `new-${randomUUID()}@example.com`;
  const { tenant, invitation } = await makeInvitation(email);

  const result = await acceptInvitation({
    token: invitation.token,
    name: "Karyawan Baru",
    password: "Reverify-Password-123",
    ip: "203.0.113.52",
  });

  const user = await db.user.findUnique({ where: { id: result.userId } });
  assert.equal(user?.email, email);
  assert.equal(user?.name, "Karyawan Baru");
  assert.notEqual(user?.passwordHash, "Reverify-Password-123");
  const member = await db.workspaceMember.findUnique({ where: { id: result.memberId } });
  assert.equal(member?.status, "ACTIVE");
  assert.equal(member?.userId, result.userId);
  assert.equal(
    await db.workspaceMember.count({ where: { tenantId: tenant.tenantId, userId: result.userId } }),
    1,
  );
});

test("B2-4: existing user tanpa sesi wajib login; user baru wajib name/password", async () => {
  const email = `login-${randomUUID()}@example.com`;
  const { invitation } = await makeInvitation(email);
  await existingUser(email);

  await assert.rejects(
    () => acceptInvitation({ token: invitation.token }),
    (error: unknown) =>
      error instanceof HttpError && error.status === 401 && error.code === "LOGIN_REQUIRED",
  );

  const fresh = await makeInvitation(`fresh-${randomUUID()}@example.com`);
  await assert.rejects(
    () => acceptInvitation({ token: fresh.invitation.token }),
    (error: unknown) =>
      error instanceof HttpError &&
      error.status === 400 &&
      error.code === "ACCOUNT_DETAILS_REQUIRED",
  );
});
