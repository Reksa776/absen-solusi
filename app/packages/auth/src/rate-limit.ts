import { RedisConnection } from "./redis.js";

export type RateLimitDecision = {
  allowed: boolean;
  retryAfterSeconds: number;
  reason?: "limit" | "unavailable";
};

export interface RateLimiter {
  consume(
    key: string,
    limit: number,
    windowMs: number,
    now?: Date,
  ): Promise<RateLimitDecision>;
}

export const LOGIN_RATE_LIMIT = 10;
export const LOGIN_RATE_WINDOW_MS = 15 * 60 * 1000;
export const API_RATE_LIMIT = 300;
export const API_RATE_WINDOW_MS = 60 * 1000;
export const WORKSPACE_MUTATION_RATE_LIMIT = 30;
export const WORKSPACE_MUTATION_RATE_WINDOW_MS = 60 * 1000;
export const REGISTER_RATE_LIMIT = 5;
export const REGISTER_RATE_WINDOW_MS = 60 * 60 * 1000;

type Bucket = { count: number; resetAt: number };

/**
 * Rate limiter in-memory per proses. Cukup untuk Phase 1 (satu instance).
 * Bila backend penyimpanan gagal, `consume` melempar error dan pemanggil
 * wajib menolak request (fail-closed) — lihat enforceLoginRateLimit().
 */
export class MemoryRateLimiter implements RateLimiter {
  private readonly buckets = new Map<string, Bucket>();

  async consume(
    key: string,
    limit: number,
    windowMs: number,
    now: Date = new Date(),
  ): Promise<RateLimitDecision> {
    const current = this.buckets.get(key);
    const nowMs = now.getTime();

    if (!current || current.resetAt <= nowMs) {
      this.buckets.set(key, { count: 1, resetAt: nowMs + windowMs });
      return { allowed: true, retryAfterSeconds: 0 };
    }

    if (current.count >= limit) {
      return {
        allowed: false,
        retryAfterSeconds: Math.max(1, Math.ceil((current.resetAt - nowMs) / 1000)),
        reason: "limit",
      };
    }

    current.count += 1;
    return { allowed: true, retryAfterSeconds: 0 };
  }

  clear(): void {
    this.buckets.clear();
  }
}

/** Fail-closed: backend yang tidak tersedia tidak pernah meloloskan request. */
export class UnavailableRateLimiter implements RateLimiter {
  async consume(): Promise<RateLimitDecision> {
    throw new Error("Rate limiter backend tidak tersedia");
  }
}

const REDIS_INCR_SCRIPT = `
local current = redis.call('INCR', KEYS[1])
if current == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
local ttl = redis.call('PTTL', KEYS[1])
if ttl < 0 then redis.call('PEXPIRE', KEYS[1], ARGV[1]); ttl = tonumber(ARGV[1]) end
return {current, ttl}
`;

/** Limiter Redis atomik; satu bucket fixed-window per key. */
export class RedisRateLimiter implements RateLimiter {
  private readonly connection: RedisConnection;

  constructor(url: string) {
    this.connection = new RedisConnection(url);
  }

  async consume(key: string, limit: number, windowMs: number): Promise<RateLimitDecision> {
    const reply = await this.connection.command([
      "EVAL",
      REDIS_INCR_SCRIPT,
      "1",
      key,
      String(windowMs),
    ]);
    if (!Array.isArray(reply) || reply.length < 2) {
      throw new Error("Balasan rate limiter Redis tidak valid");
    }
    const count = Number(reply[0]);
    const ttl = Number(reply[1]);
    if (!Number.isFinite(count) || count > limit) {
      return {
        allowed: false,
        retryAfterSeconds: Number.isFinite(ttl) && ttl > 0 ? Math.ceil(ttl / 1000) : 60,
        reason: "limit",
      };
    }
    return { allowed: true, retryAfterSeconds: 0 };
  }

  close(): void {
    this.connection.close();
  }
}

/**
 * Production selalu memakai Redis dan fail-closed bila REDIS_URL tidak ada.
 * Dev/test boleh memakai memory hanya dengan opt-in eksplisit, sehingga
 * default production tidak pernah diam-diam memakai state per proses.
 */
export function createRateLimiterFromEnv(env: NodeJS.ProcessEnv = process.env): RateLimiter {
  if (env.S1_RATE_LIMITER === "memory") return new MemoryRateLimiter();
  if (env.REDIS_URL) return new RedisRateLimiter(env.REDIS_URL);
  if (env.NODE_ENV === "production") return new UnavailableRateLimiter();
  return new MemoryRateLimiter();
}

let sharedLimiter: RateLimiter = createRateLimiterFromEnv();

export function setLoginRateLimiter(limiter: RateLimiter): void {
  sharedLimiter = limiter;
}

export function getLoginRateLimiter(): RateLimiter {
  return sharedLimiter;
}

export type UserRateLimitOutcome =
  | { allowed: true }
  | { allowed: false; status: 429 | 503; retryAfterSeconds: number; message: string };

/** Bucket API umum dan bucket aksi workspace yang lebih ketat. */
export async function enforceUserRateLimit(input: {
  userId: string;
  bucket:
    | "api"
    | "workspace.create"
    | "workspace.invite"
    | "workspace.member"
    | "workspace.role"
    | "workspace.switch"
    | "workspace.office"
    | "workspace.organization"
    | "correction.bulk";
  limiter?: RateLimiter | undefined;
  now?: Date | undefined;
}): Promise<UserRateLimitOutcome> {
  const limiter = input.limiter ?? getLoginRateLimiter();
  const now = input.now ?? new Date();
  const isApi = input.bucket === "api";
  const limit = isApi ? API_RATE_LIMIT : WORKSPACE_MUTATION_RATE_LIMIT;
  const windowMs = isApi ? API_RATE_WINDOW_MS : WORKSPACE_MUTATION_RATE_WINDOW_MS;
  try {
    const decision = await limiter.consume(
      `${isApi ? "api" : "workspace"}:user:${input.userId}:${input.bucket}`,
      limit,
      windowMs,
      now,
    );
    if (decision.allowed) return { allowed: true };
    return {
      allowed: false,
      status: decision.reason === "unavailable" ? 503 : 429,
      retryAfterSeconds: decision.retryAfterSeconds,
      message: isApi
        ? "Terlalu banyak request untuk akun ini"
        : "Terlalu banyak perubahan workspace untuk akun ini",
    };
  } catch {
    return {
      allowed: false,
      status: 503,
      retryAfterSeconds: 60,
      message: "Rate limiter tidak tersedia; request ditolak sementara",
    };
  }
}

export type LoginRateLimitInput = {
  ip: string;
  email: string;
  limiter?: RateLimiter | undefined;
  now?: Date | undefined;
};

export type LoginRateLimitOutcome =
  | { allowed: true }
  | { allowed: false; status: 429 | 503; retryAfterSeconds: number; message: string };

/**
 * Bucket khusus pendaftaran publik. Tidak ada akun untuk dikunci sebelum
 * register, jadi kunci hanya IP; kegagalan backend tetap fail-closed (503).
 */
export async function enforceRegisterRateLimit(input: {
  ip: string;
  limiter?: RateLimiter | undefined;
  now?: Date | undefined;
}): Promise<UserRateLimitOutcome> {
  const limiter = input.limiter ?? getLoginRateLimiter();
  try {
    const decision = await limiter.consume(
      `register:ip:${input.ip}`,
      REGISTER_RATE_LIMIT,
      REGISTER_RATE_WINDOW_MS,
      input.now ?? new Date(),
    );
    if (decision.allowed) return { allowed: true };
    return {
      allowed: false,
      status: decision.reason === "unavailable" ? 503 : 429,
      retryAfterSeconds: decision.retryAfterSeconds,
      message: "Terlalu banyak pendaftaran dari alamat ini",
    };
  } catch {
    return {
      allowed: false,
      status: 503,
      retryAfterSeconds: 60,
      message: "Rate limiter tidak tersedia; pendaftaran ditolak sementara",
    };
  }
}

/**
 * Cek dua bucket: per IP dan per akun. Kegagalan backend = tolak (fail-closed).
 */
export async function enforceLoginRateLimit(
  input: LoginRateLimitInput,
): Promise<LoginRateLimitOutcome> {
  const limiter = input.limiter ?? getLoginRateLimiter();
  const now = input.now ?? new Date();
  const buckets: Array<[string, string]> = [
    [`login:ip:${input.ip}`, "Terlalu banyak percobaan login dari alamat ini"],
    [`login:account:${input.email.toLowerCase()}`, "Terlalu banyak percobaan login untuk akun ini"],
  ];

  for (const [key, message] of buckets) {
    let decision: RateLimitDecision;
    try {
      decision = await limiter.consume(key, LOGIN_RATE_LIMIT, LOGIN_RATE_WINDOW_MS, now);
    } catch {
      return {
        allowed: false,
        status: 503,
        retryAfterSeconds: 60,
        message: "Rate limiter tidak tersedia; login ditolak sementara",
      };
    }
    if (!decision.allowed) {
      return {
        allowed: false,
        status: decision.reason === "unavailable" ? 503 : 429,
        retryAfterSeconds: decision.retryAfterSeconds,
        message,
      };
    }
  }

  return { allowed: true };
}
