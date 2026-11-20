import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test, { after, before } from "node:test";

import type { PrismaClient } from "@absensi/database";

import {
  ARGON2_OPTIONS,
  assertPasswordPolicy,
  hashPassword,
  verifyPassword,
} from "./password.js";
import { registerBootstrap, loginWithPassword } from "./users.js";
import {
  createSession,
  LAST_SEEN_THROTTLE_MS,
  revokeAllSessionsForUser,
  revokeSession,
  rotateSession,
  SESSION_ABSOLUTE_TTL_MS,
  SESSION_IDLE_TIMEOUT_MS,
  validateSession,
} from "./session.js";
import {
  MemoryRateLimiter,
  setLoginRateLimiter,
} from "./rate-limit.js";
import { requirePermission, HttpError } from "./http.js";
import { adminClient, bearerRequest, cookieRequest, resetDatabase, seedTenant } from "./test-support.js";
import { writeAudit } from "@absensi/database";

let db: PrismaClient = null as unknown as PrismaClient;

before(async () => {
  db = adminClient();
  await resetDatabase(db);
  process.env.ALLOW_REGISTRATION = "true";
  setLoginRateLimiter(new MemoryRateLimiter());
});

after(async () => {
  if (!db) return;
  await resetDatabase(db);
  await db.$disconnect();
});

test("B1: hash password memakai Argon2id m=19456 t=2 p=1 dan verifikasi benar", async () => {
  const hash = await hashPassword("rahasia-sekali-123");
  assert.match(hash, /^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
  assert.equal(await verifyPassword(hash, "rahasia-sekali-123"), true);
  assert.equal(await verifyPassword(hash, "salah"), false);
  assert.equal(await verifyPassword("bukan-hash", "apa pun"), false);
  assert.equal(ARGON2_OPTIONS.memoryCost, 19456);
  assert.throws(() => assertPasswordPolicy("pendek"), /minimal/i);
});

test("B2: register bootstrap membuat user, workspace, 8 role, membership owner, dan audit", async () => {
  await resetDatabase(db);
  const result = await registerBootstrap({
    email: "Bootstrap@Example.COM ",
    password: "password-bootstrap-1",
    name: "Bootstrap User",
    workspaceName: "Bootstrap Workspace",
    ip: "203.0.113.9",
    userAgent: "test-agent",
  });
  assert.equal(result.user.email, "bootstrap@example.com");
  assert.equal(await db.role.count({ where: { tenantId: result.workspace.id } }), 8);
  const member = await db.workspaceMember.findUnique({ where: { id: result.memberId } });
  assert.equal(member?.status, "ACTIVE");
  assert.equal(member?.tenantId, result.workspace.id);

  const audit = await db.auditLog.findFirst({ where: { action: "auth.register_bootstrap" } });
  assert.ok(audit);
  assert.equal(audit?.tenantId, result.workspace.id);
  assert.equal(audit?.actorUserId, result.user.id);
  assert.equal(audit?.actorMemberId, result.memberId);
  assert.equal(audit?.ipHash?.length, 32);
});

test("B3: register bootstrap ditolak setelah ada user", async () => {
  await assert.rejects(
    () =>
      registerBootstrap({
        email: "kedua@example.com",
        password: "password-kedua-123",
        name: "Kedua",
      }),
    (error: unknown) => error instanceof HttpError && error.status === 403,
  );
});

test("B4: login benar mengembalikan token, workspace aktif, dan audit auth.login", async () => {
  const password = "password-login-123";
  const passwordHash = await hashPassword(password);
  const tenant = await seedTenant(db, { passwordHash });

  const result = await loginWithPassword({
    email: tenant.ownerEmail,
    password,
    ip: "198.51.100.7",
    userAgent: "test-login",
  });
  assert.ok(result.token);
  assert.equal(result.activeTenantId, tenant.tenantId);
  assert.equal(result.workspaces.length, 1);

  const session = await validateSession(result.token);
  assert.equal(session?.userId, tenant.ownerUserId);

  const audit = await db.auditLog.findFirst({
    where: { action: "auth.login", tenantId: tenant.tenantId },
  });
  assert.ok(audit);
  assert.equal(audit?.actorUserId, tenant.ownerUserId);
  assert.equal(audit?.actorMemberId, tenant.ownerMemberId);
  assert.equal(audit?.ipHash?.length, 32);
});

test("B5: password salah ditolak 401 dan tidak membuat sesi", async () => {
  const tenant = await seedTenant(db, { passwordHash: await hashPassword("password-benar-123") });
  await assert.rejects(
    () =>
      loginWithPassword({
        email: tenant.ownerEmail,
        password: "password-salah-123",
        ip: "198.51.100.8",
        limiter: new MemoryRateLimiter(),
      }),
    (error: unknown) => error instanceof HttpError && error.status === 401,
  );
});

test("B6: rate limit login 10/15 menit per IP dan per akun, fail-closed bila backend gagal", async () => {
  const limiter = new MemoryRateLimiter();
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const outcome = await (await import("./rate-limit.js")).enforceLoginRateLimit({
      ip: "192.0.2.1",
      email: "rate@example.com",
      limiter,
      now: new Date("2026-01-01T00:00:00Z"),
    });
    assert.equal(outcome.allowed, true);
  }
  const blockedIp = await (await import("./rate-limit.js")).enforceLoginRateLimit({
    ip: "192.0.2.1",
    email: "other@example.com",
    limiter,
    now: new Date("2026-01-01T00:01:00Z"),
  });
  assert.equal(blockedIp.allowed, false);
  assert.equal(blockedIp.allowed === false && blockedIp.status, 429);

  const blockedAccount = await (await import("./rate-limit.js")).enforceLoginRateLimit({
    ip: "192.0.2.2",
    email: "rate@example.com",
    limiter,
    now: new Date("2026-01-01T00:01:00Z"),
  });
  assert.equal(blockedAccount.allowed, false);

  const failingLimiter = {
    async consume() {
      throw new Error("backend down");
    },
  };
  const failClosed = await (await import("./rate-limit.js")).enforceLoginRateLimit({
    ip: "192.0.2.3",
    email: "x@example.com",
    limiter: failingLimiter,
  });
  assert.equal(failClosed.allowed, false);
  assert.equal(failClosed.allowed === false && failClosed.status, 503);
});

test("B7: CSRF double-submit — tanpa token 403, dengan token sama lolos", async () => {
  const tenant = await seedTenant(db);
  const csrf = "csrf-token-uji-1234567890";

  await assert.rejects(
    () =>
      requirePermission(cookieRequest(tenant.ownerToken, { method: "POST", body: {} }), "workspace.read"),
    (error: unknown) => error instanceof HttpError && error.status === 403,
  );

  // Cookie dan header sengaja berbeda; ini benar-benar menguji mismatch,
  // bukan sekadar mengirim token yang sama di kedua sisi.
  const mismatched = new Request("http://localhost/api/test", {
    method: "POST",
    headers: {
      cookie: `aos_session=${tenant.ownerToken}; aos_csrf=cookie-token`,
      "x-csrf-token": "header-token",
      "content-type": "application/json",
    },
    body: "{}",
  });
  await assert.rejects(
    () => requirePermission(mismatched, "workspace.read"),
    (error: unknown) => error instanceof HttpError && error.status === 403,
  );

  // GET tidak membutuhkan CSRF.
  const safe = await requirePermission(cookieRequest(tenant.ownerToken), "workspace.read");
  assert.equal(safe.ctx.tenantId, tenant.tenantId);
});

test("B8: mode Bearer dan cookie menghasilkan tenant context yang sama", async () => {
  const tenant = await seedTenant(db);
  const viaBearer = await requirePermission(bearerRequest(tenant.ownerToken), "workspace.read");
  const viaCookie = await requirePermission(cookieRequest(tenant.ownerToken), "workspace.read");

  assert.equal(viaBearer.mode, "bearer");
  assert.equal(viaCookie.mode, "cookie");
  assert.equal(viaBearer.ctx.tenantId, viaCookie.ctx.tenantId);
  assert.equal(viaBearer.ctx.memberId, viaCookie.ctx.memberId);
  assert.deepEqual([...viaBearer.ctx.permissions], [...viaCookie.ctx.permissions]);
});

test("B9: TTL absolut 7 hari dan idle timeout 24 jam", async () => {
  const tenant = await seedTenant(db);
  const base = new Date("2026-01-01T00:00:00Z");
  const { token } = await createSession({
    userId: tenant.ownerUserId,
    activeTenantId: tenant.tenantId,
    now: base,
  });

  assert.ok(await validateSession(token, { now: new Date(base.getTime() + 1000), touch: false }));
  assert.equal(
    await validateSession(token, { now: new Date(base.getTime() + SESSION_ABSOLUTE_TTL_MS + 1000), touch: false }),
    null,
  );

  await db.session.updateMany({
    where: { userId: tenant.ownerUserId },
    data: { lastSeenAt: new Date(base.getTime() - SESSION_IDLE_TIMEOUT_MS - 1000) },
  });
  assert.equal(await validateSession(token, { now: base, touch: false }), null);
});

test("B10: last_seen_at hanya diperbarui setelah throttle 1 jam", async () => {
  const tenant = await seedTenant(db);
  const base = new Date("2026-02-01T00:00:00Z");
  const { token, session } = await createSession({
    userId: tenant.ownerUserId,
    activeTenantId: tenant.tenantId,
    now: base,
  });

  const before = await db.session.findUnique({ where: { id: session.id } });
  await validateSession(token, { now: new Date(base.getTime() + 30 * 60 * 1000) });
  const after30 = await db.session.findUnique({ where: { id: session.id } });
  assert.equal(after30?.lastSeenAt.getTime(), before?.lastSeenAt.getTime());

  await validateSession(token, { now: new Date(base.getTime() + LAST_SEEN_THROTTLE_MS + 60_000) });
  const after61 = await db.session.findUnique({ where: { id: session.id } });
  assert.equal(
    after61?.lastSeenAt.getTime(),
    base.getTime() + LAST_SEEN_THROTTLE_MS + 60_000,
  );
});

test("B11: rotateSession mengganti token pada session yang sama; token lama ditolak", async () => {
  const tenant = await seedTenant(db);
  const { token, session } = await createSession({
    userId: tenant.ownerUserId,
    activeTenantId: tenant.tenantId,
  });

  const rotated = await rotateSession(token);
  assert.ok(rotated && rotated !== token);
  assert.equal(await validateSession(token, { touch: false }), null);
  const next = await validateSession(rotated as string, { touch: false });
  assert.equal(next?.id, session.id);
  assert.equal(next?.expiresAt.getTime(), session.expiresAt.getTime());
});

test("B12: revokeSession dan revokeAllSessionsForUser mencabut akses", async () => {
  const tenant = await seedTenant(db);
  const first = await createSession({ userId: tenant.ownerUserId, activeTenantId: tenant.tenantId });
  const second = await createSession({ userId: tenant.ownerUserId, activeTenantId: tenant.tenantId });

  assert.equal(await revokeSession(first.token), true);
  assert.equal(await validateSession(first.token, { touch: false }), null);
  assert.ok(await validateSession(second.token, { touch: false }));

  const revoked = await revokeAllSessionsForUser(tenant.ownerUserId);
  assert.ok(revoked >= 1);
  assert.equal(await validateSession(second.token, { touch: false }), null);
});

test("B13: sesi tanpa active tenant ditolak 403 oleh requirePermission", async () => {
  const tenant = await seedTenant(db);
  const { token } = await createSession({ userId: tenant.ownerUserId, activeTenantId: null });
  await assert.rejects(
    () => requirePermission(bearerRequest(token), "workspace.read"),
    (error: unknown) => error instanceof HttpError && error.status === 403,
  );
});

test("B14: audit login tidak menyimpan token/hash di metadata", async () => {
  const passwordHash = await hashPassword("password-audit-123");
  const tenant = await seedTenant(db, { passwordHash });
  const result = await loginWithPassword({
    email: tenant.ownerEmail,
    password: "password-audit-123",
    ip: "203.0.113.44",
    limiter: new MemoryRateLimiter(),
  });
  const audit = await db.auditLog.findFirst({ where: { action: "auth.login" } });
  const raw = JSON.stringify(audit?.metadata);
  assert.equal(raw.includes(result.token), false);
  assert.equal(raw.includes(passwordHash), false);
  assert.equal(audit?.ipHash?.length, 32);
  const id = randomUUID();
  await writeAudit({
    tenantId: tenant.tenantId,
    actorType: "USER",
    actorUserId: tenant.ownerUserId,
    action: "test.redaction",
    resourceType: "test",
    metadata: { token: "abc", passwordHash },
    resourceId: id,
  });
  const redacted = await db.auditLog.findFirst({ where: { action: "test.redaction" } });
  assert.equal(JSON.stringify(redacted?.metadata).includes("abc"), false);
  assert.match(JSON.stringify(redacted?.metadata), /REDACTED/);
});
