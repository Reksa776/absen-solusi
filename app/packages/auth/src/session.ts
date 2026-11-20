import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";

import { hashIp, systemDb } from "@absensi/database";

export const SESSION_ABSOLUTE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const SESSION_IDLE_TIMEOUT_MS = 24 * 60 * 60 * 1000;
export const LAST_SEEN_THROTTLE_MS = 60 * 60 * 1000;

export const SESSION_COOKIE_PROD = "__Host-aos_session";
export const SESSION_COOKIE_DEV = "aos_session";

/**
 * HTTPS tetap menjadi default production. Deployment HTTP langsung (IP:port)
 * dapat mematikan Secure dan prefix __Host- lewat COOKIE_SECURE=false.
 */
export function cookiesRequireSecure(): boolean {
  const configured = process.env.COOKIE_SECURE?.trim().toLowerCase();
  if (configured === "false") return false;
  if (configured === "true") return true;
  return process.env.NODE_ENV === "production";
}

export function sessionCookieName(): string {
  return cookiesRequireSecure() ? SESSION_COOKIE_PROD : SESSION_COOKIE_DEV;
}

export type AuthSession = {
  id: string;
  userId: string;
  activeTenantId: string | null;
  lastSeenAt: Date;
  expiresAt: Date;
};

export type CreateSessionInput = {
  userId: string;
  activeTenantId: string | null;
  ip?: string | null | undefined;
  userAgent?: string | null | undefined;
  now?: Date | undefined;
};

/** Token mentah 32 byte (base64url); DB hanya menyimpan SHA-256 hex-nya. */
export function generateSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

export function sessionTokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function createSession(
  input: CreateSessionInput,
): Promise<{ token: string; session: AuthSession }> {
  const token = generateSessionToken();
  const now = input.now ?? new Date();
  const session = {
    id: randomUUID(),
    userId: input.userId,
    tokenHash: sessionTokenHash(token),
    activeTenantId: input.activeTenantId,
    ipHash: hashIp(input.ip),
    userAgent: input.userAgent?.slice(0, 255) ?? null,
    lastSeenAt: now,
    expiresAt: new Date(now.getTime() + SESSION_ABSOLUTE_TTL_MS),
  };

  // SYSTEM: session adalah tabel platform-level (tidak punya tenant_id).
  await systemDb().session.create({ data: session });

  return {
    token,
    session: {
      id: session.id,
      userId: session.userId,
      activeTenantId: session.activeTenantId,
      lastSeenAt: session.lastSeenAt,
      expiresAt: session.expiresAt,
    },
  };
}

export type ValidateSessionOptions = {
  now?: Date | undefined;
  touch?: boolean | undefined;
};

/**
 * Validasi token: revoked, TTL absolut 7 hari, idle 24 jam. last_seen_at
 * diperbarui paling sering sekali per jam (throttle).
 */
export async function validateSession(
  token: string,
  options: ValidateSessionOptions = {},
): Promise<AuthSession | null> {
  if (!token || token.length > 512) return null;
  const now = options.now ?? new Date();

  // SYSTEM: lookup sesi berdasarkan hash token; tidak ada tenant context.
  const db = systemDb();
  const row = await db.session.findUnique({
    where: { tokenHash: sessionTokenHash(token) },
  });
  if (!row || row.revokedAt) return null;
  if (row.expiresAt.getTime() <= now.getTime()) return null;
  if (now.getTime() - row.lastSeenAt.getTime() > SESSION_IDLE_TIMEOUT_MS) return null;

  if (options.touch !== false && now.getTime() - row.lastSeenAt.getTime() >= LAST_SEEN_THROTTLE_MS) {
    await db.session.updateMany({
      where: { id: row.id, revokedAt: null },
      data: { lastSeenAt: now },
    });
  }

  return {
    id: row.id,
    userId: row.userId,
    activeTenantId: row.activeTenantId,
    lastSeenAt: row.lastSeenAt,
    expiresAt: row.expiresAt,
  };
}

/**
 * Rotasi token pada session yang sama saat privilege berubah. TTL absolut
 * tidak diperpanjang. Token lama langsung tidak berlaku.
 */
export async function rotateSession(token: string, now: Date = new Date()): Promise<string | null> {
  const db = systemDb();
  const row = await db.session.findUnique({
    where: { tokenHash: sessionTokenHash(token) },
  });
  if (!row || row.revokedAt || row.expiresAt.getTime() <= now.getTime()) return null;

  const nextToken = generateSessionToken();
  const result = await db.session.updateMany({
    where: { id: row.id, revokedAt: null },
    data: { tokenHash: sessionTokenHash(nextToken), lastSeenAt: now },
  });
  return result.count === 1 ? nextToken : null;
}

export async function revokeSession(token: string, now: Date = new Date()): Promise<boolean> {
  const result = await systemDb().session.updateMany({
    where: { tokenHash: sessionTokenHash(token), revokedAt: null },
    data: { revokedAt: now },
  });
  return result.count === 1;
}

export async function revokeAllSessionsForUser(
  userId: string,
  now: Date = new Date(),
): Promise<number> {
  const result = await systemDb().session.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: now },
  });
  return result.count;
}

/** Sesi aktif user + workspace tempat ia menjadi member ACTIVE. */
export async function loadWorkspacesForUser(userId: string): Promise<
  Array<{ id: string; name: string; slug: string; memberId: string; roleKeys: string[] }>
> {
  // SYSTEM: daftar workspace lintas tenant milik user yang sedang login.
  const memberships = await systemDb().workspaceMember.findMany({
    where: { userId, status: "ACTIVE", workspace: { status: "ACTIVE" } },
    include: {
      workspace: true,
      roles: { include: { role: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  return memberships.map((member) => ({
    id: member.workspace.id,
    name: member.workspace.name,
    slug: member.workspace.slug,
    memberId: member.id,
    roleKeys: member.roles.map((assignment) => assignment.role.key).sort(),
  }));
}
