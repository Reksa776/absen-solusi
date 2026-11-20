import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import test, { after, before } from "node:test";

import { hashIp, REDACTED, sanitizeMetadata, writeAudit } from "./audit.js";
import { createPrismaClient } from "./client.js";
import type { PrismaClient } from "./generated/prisma/client.js";
import { assertIsolatedTestDatabase } from "./test-db-guard.js";

let admin: PrismaClient = null as unknown as PrismaClient;
let app: PrismaClient = null as unknown as PrismaClient;
const tenantId = randomUUID();
const userId = randomUUID();
const memberId = randomUUID();

before(async () => {
  assert.ok(process.env.DATABASE_URL, "DATABASE_URL wajib untuk test admin");
  assertIsolatedTestDatabase(process.env.DATABASE_URL, "DATABASE_URL");
  assertIsolatedTestDatabase(process.env.APP_DATABASE_URL, "APP_DATABASE_URL");
  admin = createPrismaClient(process.env.DATABASE_URL);
  app = createPrismaClient(process.env.APP_DATABASE_URL);
  await admin.backgroundJobAttempt.deleteMany();
  await admin.backgroundJob.deleteMany();
  await admin.memberRole.deleteMany();
  await admin.workspaceInvitation.deleteMany();
  await admin.rolePermission.deleteMany();
  await admin.workspaceMember.deleteMany();
  await admin.role.deleteMany();
  await admin.session.deleteMany();
  await admin.workspace.deleteMany();
  await admin.auditLog.deleteMany();
  await admin.user.deleteMany();
  await admin.user.create({
    data: { id: userId, email: `audit-${userId}@test.local`, passwordHash: "x", name: "Audit" },
  });
  await admin.workspace.create({ data: { id: tenantId, name: "Audit WS", slug: `aud-${tenantId}` } });
  await admin.workspaceMember.create({
    data: { id: memberId, tenantId, userId, status: "ACTIVE", joinedAt: new Date() },
  });
});

after(async () => {
  if (!admin) return;
  await admin.backgroundJobAttempt.deleteMany();
  await admin.backgroundJob.deleteMany();
  await admin.memberRole.deleteMany();
  await admin.workspaceInvitation.deleteMany();
  await admin.rolePermission.deleteMany();
  await admin.workspaceMember.deleteMany();
  await admin.role.deleteMany();
  await admin.session.deleteMany();
  await admin.workspace.deleteMany();
  await admin.auditLog.deleteMany();
  await admin.user.deleteMany();
  await admin.$disconnect();
  if (app) await app.$disconnect();
});

test("writeAudit menyimpan tenant, actor, ip_hash 32 byte, dan metadata tanpa secret", async () => {
  const id = await writeAudit({
    tenantId,
    actorType: "USER",
    actorUserId: userId,
    actorMemberId: memberId,
    action: "workspace.create",
    resourceType: "workspace",
    resourceId: tenantId,
    metadata: { name: "Audit WS", token: "rahasia", nested: { password: "p" }, roleKey: "OWNER" },
    ip: "203.0.113.9",
    userAgent: "node-test",
  });

  const row = await admin.auditLog.findUniqueOrThrow({ where: { id } });
  assert.equal(row.tenantId, tenantId);
  assert.equal(row.actorUserId, userId);
  assert.equal(row.actorMemberId, memberId);
  assert.equal(row.actorType, "USER");
  assert.equal(row.ipHash?.length, 32);
  assert.deepEqual(Buffer.from(row.ipHash ?? []), createHash("sha256").update("203.0.113.9").digest());
  const metadata = row.metadata as Record<string, unknown>;
  assert.equal(metadata.roleKey, "OWNER");
  assert.equal(metadata.token, REDACTED);
  assert.deepEqual(metadata.nested, { password: REDACTED });
  assert.equal(JSON.stringify(row.metadata).includes("rahasia"), false);
});

test("metadata null tetap null dan tidak crash", async () => {
  const id = await writeAudit({
    tenantId,
    actorType: "USER",
    actorUserId: userId,
    action: "member.invite",
    resourceType: "member",
  });
  const row = await admin.auditLog.findUniqueOrThrow({ where: { id } });
  assert.equal(row.metadata, null);
});

test("aksi tanpa format domain.verb ditolak", async () => {
  await assert.rejects(
    () =>
      writeAudit({
        tenantId,
        actorType: "USER",
        action: "bukanformat",
        resourceType: "workspace",
      }),
    /domain\.verb/,
  );
});

test("grant DB: UPDATE audit_logs ditolak akun runtime", async () => {
  const row = await admin.auditLog.findFirstOrThrow({ where: { tenantId } });
  await assert.rejects(
    () => app.auditLog.update({ where: { id: row.id }, data: { action: "tampered.action" } }),
  );
  const after = await admin.auditLog.findUniqueOrThrow({ where: { id: row.id } });
  assert.notEqual(after.action, "tampered.action");
});

test("grant DB: DELETE audit_logs ditolak akun runtime", async () => {
  const row = await admin.auditLog.findFirstOrThrow({ where: { tenantId } });
  await assert.rejects(() => app.auditLog.delete({ where: { id: row.id } }));
  assert.ok(await admin.auditLog.findUnique({ where: { id: row.id } }));
});

test("grant DB: DDL pada audit_logs ditolak akun runtime", async () => {
  await assert.rejects(() =>
    app.$executeRawUnsafe("ALTER TABLE audit_logs ADD COLUMN tamper INT NULL"),
  );
});

test("hashIp null untuk IP kosong dan 32 byte untuk IP valid", () => {
  assert.equal(hashIp(null), null);
  assert.equal(hashIp("127.0.0.1")?.length, 32);
});

test("sanitizeMetadata meredaksi kunci sensitif bersarang", () => {
  const result = sanitizeMetadata({
    authorization: "Bearer x",
    cookies: { session: "abc" },
    safe: "value",
    list: [{ password: "x" }, "ok"],
  }) as Record<string, unknown>;
  assert.equal(result.authorization, REDACTED);
  // Kunci kontainer yang mengandung kata sensitif ikut diredaksi seluruhnya.
  assert.equal(result.cookies, REDACTED);
  assert.equal(result.safe, "value");
  assert.deepEqual(result.list, [{ password: REDACTED }, "ok"]);
});
