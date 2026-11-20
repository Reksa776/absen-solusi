import { randomUUID } from "node:crypto";

import {
  createDefaultRolesForWorkspace,
  createTenantContext,
  enqueueAuditOutbox,
  hashIp,
  systemDb,
  withTenant,
  writeAudit,
  type TenantContext,
} from "@absensi/database";

import { csrfTokenMatches, CSRF_COOKIE, CSRF_HEADER } from "./csrf.js";
import { HttpError, isSafeMethod, parseCookies } from "./http.js";
import { logger } from "./logger.js";
import { hashPassword, verifyPassword } from "./password.js";
import { enforceLoginRateLimit, type RateLimiter } from "./rate-limit.js";
import {
  createSession,
  loadWorkspacesForUser,
  SESSION_ABSOLUTE_TTL_MS,
} from "./session.js";
import {
  createTwoFactorChallenge,
  isTwoFactorEnabled,
  verifyLoginSecondFactor,
  verifyTwoFactorChallenge,
  type TwoFactorChallenge,
} from "./two-factor.js";
import { isRoleKey, ROLE_KEYS, type RoleKey } from "@absensi/permissions";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function assertEmail(email: string): string {
  const normalized = normalizeEmail(email);
  if (!EMAIL_PATTERN.test(normalized) || normalized.length > 255) {
    throw new HttpError(400, "INVALID_EMAIL", "Format email tidak valid");
  }
  return normalized;
}

export function assertName(name: string): string {
  const trimmed = name.trim();
  if (trimmed.length < 2 || trimmed.length > 120) {
    throw new HttpError(400, "INVALID_NAME", "Nama harus 2–120 karakter");
  }
  return trimmed;
}

function slugify(name: string): string {
  const base = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return `${base || "workspace"}-${randomUUID().slice(0, 8)}`;
}

/**
 * CSRF wajib untuk mode cookie pada request non-GET (login/register publik).
 * Login mobile boleh menyatakan mode Bearer secara eksplisit lewat
 * X-Auth-Mode: bearer tanpa header Authorization dummy.
 */
export function assertPublicCsrf(
  request: Request,
  options: { allowBearerMode?: boolean } = {},
): void {
  if (isSafeMethod(request.method)) return;
  const explicitBearer =
    request.headers.get("x-auth-mode")?.trim().toLowerCase() === "bearer";
  if (options.allowBearerMode && explicitBearer) return;
  if (request.headers.get("authorization")) return; // mode Bearer (mobile)
  const cookies = parseCookies(request.headers.get("cookie"));
  if (!csrfTokenMatches(cookies[CSRF_COOKIE], request.headers.get(CSRF_HEADER))) {
    throw new HttpError(403, "CSRF_INVALID", "Token CSRF tidak valid");
  }
}

async function safeAudit(input: Parameters<typeof writeAudit>[0]): Promise<void> {
  try {
    await writeAudit(input);
  } catch (error) {
    // Aksi non-risiko: masukkan ke outbox untuk retry tanpa payload sensitif di log.
    try {
      await enqueueAuditOutbox(input);
    } catch (outboxError) {
      logger.error("audit outbox write failed", { action: input.action, error: outboxError });
    }
  }
}

export type PublicUser = { id: string; email: string; name: string; status: string };

function toPublicUser(user: { id: string; email: string; name: string; status: string }): PublicUser {
  return { id: user.id, email: user.email, name: user.name, status: user.status };
}

export type RegisterBootstrapInput = {
  email: string;
  password: string;
  name: string;
  workspaceName?: string | undefined;
  ip?: string | null | undefined;
  userAgent?: string | null | undefined;
};

/**
 * Bootstrap user pertama. Hanya berjalan bila ALLOW_REGISTRATION=true dan
 * belum ada user sama sekali. Membuat user + workspace + 6 role + membership
 * owner secara atomik agar audit bootstrap punya tenant_id non-null.
 */
export async function registerBootstrap(
  input: RegisterBootstrapInput,
): Promise<{ user: PublicUser; workspace: { id: string; name: string; slug: string }; memberId: string }> {
  if (process.env.ALLOW_REGISTRATION !== "true") {
    throw new HttpError(403, "REGISTRATION_CLOSED", "Registrasi tidak dibuka");
  }
  const email = assertEmail(input.email);
  const name = assertName(input.name);
  const workspaceName = assertName(input.workspaceName?.trim() || `${name} Workspace`);

  // SYSTEM: bootstrap platform-level; cek jumlah user sebelum tenant ada.
  const db = systemDb();
  if ((await db.user.count()) > 0) {
    throw new HttpError(403, "REGISTRATION_CLOSED", "Registrasi bootstrap sudah ditutup");
  }

  const passwordHash = await hashPassword(input.password);
  const userId = randomUUID();
  const workspaceId = randomUUID();
  const memberId = randomUUID();
  const slug = slugify(workspaceName);

  await db.$transaction(async (tx) => {
    await tx.user.create({ data: { id: userId, email, passwordHash, name } });
    await tx.workspace.create({ data: { id: workspaceId, name: workspaceName, slug } });
    const roles = await createDefaultRolesForWorkspace(tx, workspaceId);
    await tx.workspaceMember.create({
      data: {
        id: memberId,
        tenantId: workspaceId,
        userId,
        status: "ACTIVE",
        joinedAt: new Date(),
      },
    });
    await tx.memberRole.create({
      data: { tenantId: workspaceId, memberId, roleId: roles.WORKSPACE_OWNER },
    });
  });

  await safeAudit({
    tenantId: workspaceId,
    actorType: "USER",
    actorUserId: userId,
    actorMemberId: memberId,
    action: "auth.register_bootstrap",
    resourceType: "user",
    resourceId: userId,
    metadata: { email },
    ip: input.ip ?? null,
    userAgent: input.userAgent ?? null,
  });

  return { user: { id: userId, email, name, status: "ACTIVE" }, workspace: { id: workspaceId, name: workspaceName, slug }, memberId };
}

export type LoginInput = {
  email: string;
  password: string;
  ip: string;
  userAgent?: string | null | undefined;
  limiter?: RateLimiter | undefined;
  now?: Date | undefined;
};

export type LoginResult = {
  token: string;
  user: PublicUser;
  activeTenantId: string | null;
  workspaces: Awaited<ReturnType<typeof loadWorkspacesForUser>>;
};

export type LoginOutcome = LoginResult | TwoFactorChallenge;

type PasswordLogin = {
  user: PublicUser;
  workspaces: Awaited<ReturnType<typeof loadWorkspacesForUser>>;
  activeTenantId: string | null;
};

async function authenticatePassword(input: LoginInput): Promise<PasswordLogin> {
  const email = normalizeEmail(input.email);
  const limit = await enforceLoginRateLimit({
    ip: input.ip,
    email,
    limiter: input.limiter,
    now: input.now,
  });
  if (!limit.allowed) {
    throw new HttpError(
      limit.status,
      "RATE_LIMITED",
      limit.message,
      limit.retryAfterSeconds,
    );
  }

  // SYSTEM: autentikasi platform-level sebelum tenant context terbentuk.
  const user = await systemDb().user.findUnique({ where: { email } });
  const valid = user ? await verifyPassword(user.passwordHash, input.password) : false;
  if (!user || !valid || user.status !== "ACTIVE") {
    throw new HttpError(401, "INVALID_CREDENTIALS", "Email atau password salah");
  }

  const workspaces = await loadWorkspacesForUser(user.id);
  return { user, workspaces, activeTenantId: workspaces[0]?.id ?? null };
}

async function finalizeLogin(
  resolved: PasswordLogin,
  input: { ip: string; userAgent?: string | null | undefined; now?: Date | undefined },
  method: "password" | "totp" | "backup",
): Promise<LoginResult> {
  const { token } = await createSession({
    userId: resolved.user.id,
    activeTenantId: resolved.activeTenantId,
    ip: input.ip ?? null,
    userAgent: input.userAgent ?? null,
    now: input.now,
  });

  if (resolved.activeTenantId) {
    const member = resolved.workspaces.find(
      (workspace) => workspace.id === resolved.activeTenantId,
    );
    await safeAudit({
      tenantId: resolved.activeTenantId,
      actorType: "USER",
      actorUserId: resolved.user.id,
      actorMemberId: member?.memberId ?? null,
      action: "auth.login",
      resourceType: "session",
      resourceId: resolved.user.id,
      metadata: {
        mode: input.userAgent ? "web-or-mobile" : "unknown",
        two_factor: method,
      },
      ip: input.ip ?? null,
      userAgent: input.userAgent ?? null,
    });
  }

  return {
    token,
    user: toPublicUser(resolved.user),
    activeTenantId: resolved.activeTenantId,
    workspaces: resolved.workspaces,
  };
}

export async function beginLogin(input: LoginInput): Promise<LoginOutcome> {
  const resolved = await authenticatePassword(input);
  if (await isTwoFactorEnabled(resolved.user.id)) {
    return createTwoFactorChallenge(resolved.user.id, input.now ?? new Date());
  }
  return finalizeLogin(resolved, input, "password");
}

export async function loginWithPassword(input: LoginInput): Promise<LoginResult> {
  const result = await beginLogin(input);
  if ("requiresTwoFactor" in result) {
    throw new HttpError(403, "TWO_FACTOR_REQUIRED", "Kode 2FA diperlukan");
  }
  return result;
}

export async function completeTwoFactorLogin(input: {
  challengeToken: string;
  code: string;
  ip: string;
  userAgent?: string | null | undefined;
  limiter?: RateLimiter | undefined;
  now?: Date | undefined;
}): Promise<LoginResult> {
  const challenge = verifyTwoFactorChallenge(
    input.challengeToken,
    input.now ?? new Date(),
  );
  // SYSTEM: identitas dari challenge bertanda tangan, lalu user dimuat ulang.
  const user = await systemDb().user.findUnique({ where: { id: challenge.userId } });
  if (!user || user.status !== "ACTIVE") {
    throw new HttpError(401, "INVALID_2FA_CHALLENGE", "Challenge 2FA tidak valid");
  }
  const limit = await enforceLoginRateLimit({
    ip: input.ip,
    email: user.email,
    limiter: input.limiter,
    now: input.now,
  });
  if (!limit.allowed) {
    throw new HttpError(
      limit.status,
      "RATE_LIMITED",
      limit.message,
      limit.retryAfterSeconds,
    );
  }
  const verified = await verifyLoginSecondFactor({
    userId: user.id,
    code: input.code,
    ...(input.now ? { now: input.now } : {}),
  });
  const workspaces = await loadWorkspacesForUser(user.id);
  return finalizeLogin(
    { user, workspaces, activeTenantId: workspaces[0]?.id ?? null },
    input,
    verified.method,
  );
}

/** Session context untuk route yang butuh tenant; dipakai test C. */
export async function createSessionForUser(input: {
  userId: string;
  tenantId: string | null;
  ip?: string | null | undefined;
}): Promise<string> {
  const { token } = await createSession({
    userId: input.userId,
    activeTenantId: input.tenantId,
    ip: input.ip,
  });
  return token;
}

export function assertRoleKey(value: string): RoleKey {
  if (!isRoleKey(value)) {
    throw new HttpError(400, "INVALID_ROLE", `Role harus salah satu dari: ${ROLE_KEYS.join(", ")}`);
  }
  return value;
}

export function tenantCtxFor(
  tenantId: string,
  userId: string,
  memberId: string,
  roleKeys: string[],
  permissions: string[],
): TenantContext {
  return createTenantContext({ tenantId, userId, memberId, roleKeys, permissions });
}

export const SESSION_COOKIE_MAX_AGE_SECONDS = Math.floor(SESSION_ABSOLUTE_TTL_MS / 1000);
export { hashIp, withTenant };
