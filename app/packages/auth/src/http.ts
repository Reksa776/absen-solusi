import { createTenantContext, resolveMemberPermissions, systemDb, type TenantContext } from "@absensi/database";

import { CSRF_COOKIE, CSRF_HEADER, csrfTokenMatches } from "./csrf.js";
import { enforceUserRateLimit } from "./rate-limit.js";
import { cookiesRequireSecure, sessionCookieName, validateSession, type AuthSession } from "./session.js";

export class HttpError extends Error {
  readonly status: number;
  readonly code: string;
  readonly retryAfterSeconds: number | undefined;

  constructor(
    status: number,
    code: string,
    message: string,
    retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.code = code;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

export function errorResponse(error: unknown): Response {
  if (error instanceof HttpError) {
    const response = jsonResponse(
      { error: { code: error.code, message: error.message } },
      error.status,
    );
    if (error.retryAfterSeconds !== undefined) {
      response.headers.set("Retry-After", String(error.retryAfterSeconds));
    }
    return response;
  }
  return jsonResponse(
    { error: { code: "INTERNAL_ERROR", message: "Terjadi kesalahan internal" } },
    500,
  );
}

export async function readJsonBody(request: Request): Promise<Record<string, unknown>> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw new HttpError(400, "INVALID_JSON", "Body harus JSON yang valid");
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new HttpError(400, "INVALID_BODY", "Body harus objek JSON");
  }
  return body as Record<string, unknown>;
}

export function requireString(
  body: Record<string, unknown>,
  field: string,
  maxLength = 255,
): string {
  const value = body[field];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new HttpError(400, "INVALID_INPUT", `Field ${field} wajib diisi`);
  }
  const trimmed = value.trim();
  if (trimmed.length > maxLength) {
    throw new HttpError(400, "INVALID_INPUT", `Field ${field} terlalu panjang`);
  }
  return trimmed;
}

export type CookieOptions = {
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: "lax" | "strict" | "none";
  path?: string;
  maxAgeSeconds?: number;
};

export function serializeCookie(name: string, value: string, options: CookieOptions = {}): string {
  const parts = [`${name}=${value}`, `Path=${options.path ?? "/"}`];
  if (options.maxAgeSeconds !== undefined) parts.push(`Max-Age=${options.maxAgeSeconds}`);
  if (options.httpOnly) parts.push("HttpOnly");
  if (options.secure) parts.push("Secure");
  parts.push(`SameSite=${options.sameSite ?? "Lax"}`);
  return parts.join("; ");
}

export function parseCookies(header: string | null | undefined): Record<string, string> {
  if (!header) return {};
  const out: Record<string, string> = {};
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index <= 0) continue;
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (key) out[key] = decodeURIComponent(value);
  }
  return out;
}

export function sessionCookie(token: string, maxAgeSeconds = 7 * 24 * 60 * 60): string {
  return serializeCookie(sessionCookieName(), token, {
    httpOnly: true,
    secure: cookiesRequireSecure(),
    sameSite: "lax",
    maxAgeSeconds,
  });
}

export function clearSessionCookie(): string {
  return sessionCookie("", 0);
}

export function csrfCookie(token: string): string {
  // Harus bisa dibaca JavaScript klien (double-submit), karena itu tidak httpOnly.
  return serializeCookie(CSRF_COOKIE, token, {
    httpOnly: false,
    secure: cookiesRequireSecure(),
    sameSite: "lax",
    maxAgeSeconds: 7 * 24 * 60 * 60,
  });
}

type RequestWithConnection = Request & {
  ip?: unknown;
  socket?: { remoteAddress?: unknown };
};

function directConnectionAddress(request: Request): string | undefined {
  const candidate = (request as RequestWithConnection).ip ??
    (request as RequestWithConnection).socket?.remoteAddress;
  return typeof candidate === "string" && candidate.length > 0 ? candidate : undefined;
}

/**
 * Default-deny proxy headers. X-Forwarded-For dan X-Real-IP hanya dipercaya
 * bila TRUST_PROXY=true, dan XFF diambil dari elemen paling kanan (alamat yang
 * ditambahkan proxy tepercaya), bukan elemen paling kiri yang bisa dipalsukan
 * klien. Tanpa TRUST_PROXY, gunakan alamat koneksi langsung bila tersedia.
 */
export function getClientIp(request: Request, directAddress?: string): string {
  if (process.env.TRUST_PROXY !== "true") {
    return directAddress ?? directConnectionAddress(request) ?? "unknown";
  }

  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const addresses = forwarded
      .split(",")
      .map((part) => part.trim())
      .filter((part) => part.length > 0);
    const rightmost = addresses[addresses.length - 1];
    if (rightmost) return rightmost;
  }
  const realIp = request.headers.get("x-real-ip")?.trim();
  return realIp || directAddress || directConnectionAddress(request) || "unknown";
}

export type AuthMode = "cookie" | "bearer";

export type AuthenticatedRequest = {
  session: AuthSession;
  token: string;
  mode: AuthMode;
};

export function isSafeMethod(method: string): boolean {
  return method === "GET" || method === "HEAD" || method === "OPTIONS";
}

/** Double-submit: cookie ao_csrf harus sama dengan header x-csrf-token. */
export function assertCsrf(request: Request): void {
  if (isSafeMethod(request.method)) return;
  const cookies = parseCookies(request.headers.get("cookie"));
  if (!csrfTokenMatches(cookies[CSRF_COOKIE], request.headers.get(CSRF_HEADER))) {
    throw new HttpError(403, "CSRF_INVALID", "Token CSRF tidak valid");
  }
}

export type AuthenticateOptions = {
  now?: Date | undefined;
  enforceCsrf?: boolean | undefined;
};

/**
 * Token yang sama melayani dua mode: cookie web dan Bearer mobile. Mode Bearer
 * tidak memakai CSRF karena browser tidak mengirim Authorization otomatis.
 */
export async function authenticateRequest(
  request: Request,
  options: AuthenticateOptions = {},
): Promise<AuthenticatedRequest | null> {
  const authorization = request.headers.get("authorization");
  const bearer = authorization?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  const cookies = parseCookies(request.headers.get("cookie"));
  const cookieToken = cookies[sessionCookieName()];
  const token = bearer || cookieToken;
  const mode: AuthMode = bearer ? "bearer" : "cookie";

  const session = token ? await validateSession(token, { now: options.now }) : null;
  if (!session) return null;

  if (mode === "cookie" && options.enforceCsrf !== false) assertCsrf(request);
  return { session, token: token as string, mode };
}

export async function requireApiSession(
  request: Request,
  options: AuthenticateOptions = {},
): Promise<AuthenticatedRequest> {
  const authenticated = await authenticateRequest(request, options);
  if (!authenticated) {
    throw new HttpError(401, "UNAUTHENTICATED", "Sesi tidak valid atau sudah berakhir");
  }
  const limit = await enforceUserRateLimit({
    userId: authenticated.session.userId,
    bucket: "api",
  });
  if (!limit.allowed) {
    throw new HttpError(limit.status, "RATE_LIMITED", limit.message, limit.retryAfterSeconds);
  }
  return authenticated;
}

export type AuthenticatedTenant = AuthenticatedRequest & {
  ctx: TenantContext;
  member: { id: string; status: string };
};

/**
 * Resolve membership dari session (bukan dari URL) lalu periksa permission.
 * Tenant context selalu berasal dari active_tenant_id di session.
 */
export async function requirePermission(
  request: Request,
  permission: string,
  options: AuthenticateOptions = {},
): Promise<AuthenticatedTenant> {
  const authenticated = await requireApiSession(request, options);
  const { session } = authenticated;
  if (!session.activeTenantId) {
    throw new HttpError(403, "NO_ACTIVE_WORKSPACE", "Tidak ada workspace aktif pada sesi ini");
  }

  // SYSTEM: ambil membership user pada tenant aktif; belum masuk withTenant
  // karena context belum terbentuk sebelum membership diverifikasi.
  const member = await systemDb().workspaceMember.findFirst({
    where: {
      tenantId: session.activeTenantId,
      userId: session.userId,
      status: "ACTIVE",
    },
  });
  if (!member) {
    throw new HttpError(403, "FORBIDDEN", "Anda bukan member aktif workspace ini");
  }

  const { roleKeys, permissions } = await resolveMemberPermissions(
    systemDb(),
    session.activeTenantId,
    member.id,
  );
  const ctx = createTenantContext({
    tenantId: session.activeTenantId,
    userId: session.userId,
    memberId: member.id,
    roleKeys,
    permissions,
  });

  if (!ctx.permissions.includes(permission)) {
    throw new HttpError(403, "FORBIDDEN", "Permission tidak mencukupi");
  }

  return { ...authenticated, ctx, member: { id: member.id, status: member.status } };
}
