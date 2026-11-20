import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

import { systemDb, writeAudit } from "@absensi/database";

import { HttpError } from "./http.js";
import { logger } from "./logger.js";
import { verifyPassword } from "./password.js";

export const TOTP_PERIOD_SECONDS = 30;
export const TOTP_DIGITS = 6;
export const TOTP_WINDOW_STEPS = 1;
export const TWO_FACTOR_CHALLENGE_TTL_SECONDS = 5 * 60;
export const TWO_FACTOR_ISSUER = "Absensi";
export const BACKUP_CODE_COUNT = 10;

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function encryptionKey(): Buffer {
  const raw = process.env.TWO_FACTOR_ENCRYPTION_KEY?.trim();
  if (!raw) {
    if (process.env.NODE_ENV === "production") {
      throw new HttpError(
        503,
        "TWO_FACTOR_NOT_CONFIGURED",
        "TWO_FACTOR_ENCRYPTION_KEY belum dikonfigurasi",
      );
    }
    return createHash("sha256").update("absensi-development-only-2fa-key").digest();
  }
  if (/^[0-9a-fA-F]{64}$/.test(raw)) return Buffer.from(raw, "hex");
  const decoded = Buffer.from(raw, "base64");
  if (decoded.length === 32) return decoded;
  throw new HttpError(
    503,
    "TWO_FACTOR_NOT_CONFIGURED",
    "TWO_FACTOR_ENCRYPTION_KEY harus 32 byte (hex 64 karakter atau base64)",
  );
}

function challengeKey(): Buffer {
  return createHmac("sha256", encryptionKey()).update("two-factor-challenge").digest();
}

export function encryptTwoFactorSecret(secret: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1.${iv.toString("base64url")}.${tag.toString("base64url")}.${ciphertext.toString("base64url")}`;
}

export function decryptTwoFactorSecret(value: string): string {
  const parts = value.split(".");
  if (parts.length !== 4 || parts[0] !== "v1") {
    throw new HttpError(500, "TWO_FACTOR_SECRET_INVALID", "Secret 2FA tidak valid");
  }
  try {
    const decipher = createDecipheriv(
      "aes-256-gcm",
      encryptionKey(),
      Buffer.from(parts[1] ?? "", "base64url"),
    );
    decipher.setAuthTag(Buffer.from(parts[2] ?? "", "base64url"));
    return Buffer.concat([
      decipher.update(Buffer.from(parts[3] ?? "", "base64url")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    throw new HttpError(500, "TWO_FACTOR_SECRET_INVALID", "Secret 2FA tidak dapat dibuka");
  }
}

export function base32Encode(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let output = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return output;
}

export function base32Decode(value: string): Buffer {
  const clean = value.toUpperCase().replace(/=+$/g, "").replace(/\s+/g, "");
  let bits = 0;
  let accumulator = 0;
  const output: number[] = [];
  for (const char of clean) {
    const index = BASE32_ALPHABET.indexOf(char);
    if (index < 0) throw new Error("Base32 tidak valid");
    accumulator = (accumulator << 5) | index;
    bits += 5;
    if (bits >= 8) {
      output.push((accumulator >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(output);
}

export function generateTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

function hotp(secret: string, counter: number): string {
  const key = base32Decode(secret);
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac("sha1", key).update(message).digest();
  const offset = digest[digest.length - 1]! & 0x0f;
  const binary =
    ((digest[offset]! & 0x7f) << 24) |
    ((digest[offset + 1]! & 0xff) << 16) |
    ((digest[offset + 2]! & 0xff) << 8) |
    (digest[offset + 3]! & 0xff);
  return String(binary % 10 ** TOTP_DIGITS).padStart(TOTP_DIGITS, "0");
}

export function generateTotpCode(secret: string, now: Date = new Date()): string {
  return hotp(secret, Math.floor(now.getTime() / 1000 / TOTP_PERIOD_SECONDS));
}

export function verifyTotpCode(
  secret: string,
  code: string,
  now: Date = new Date(),
  windowSteps = TOTP_WINDOW_STEPS,
): boolean {
  const normalized = code.trim();
  if (!/^\d{6}$/.test(normalized)) return false;
  const counter = Math.floor(now.getTime() / 1000 / TOTP_PERIOD_SECONDS);
  let valid = false;
  for (let delta = -windowSteps; delta <= windowSteps; delta += 1) {
    const expected = hotp(secret, counter + delta);
    if (timingSafeEqual(Buffer.from(expected), Buffer.from(normalized))) valid = true;
  }
  return valid;
}

export function otpauthUri(input: { secret: string; email: string }): string {
  const label = encodeURIComponent(`${TWO_FACTOR_ISSUER}:${input.email}`);
  const query = new URLSearchParams({
    secret: input.secret,
    issuer: TWO_FACTOR_ISSUER,
    algorithm: "SHA1",
    digits: String(TOTP_DIGITS),
    period: String(TOTP_PERIOD_SECONDS),
  });
  return `otpauth://totp/${label}?${query.toString()}`;
}

export function normalizeBackupCode(code: string): string {
  return code.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function hashBackupCode(userId: string, code: string): string {
  return createHash("sha256").update(`2fa:${userId}:${normalizeBackupCode(code)}`).digest("hex");
}

export function generateBackupCodes(): string[] {
  return Array.from({ length: BACKUP_CODE_COUNT }, () => {
    const raw = randomBytes(5).toString("hex").toUpperCase();
    return `${raw.slice(0, 5)}-${raw.slice(5, 10)}`;
  });
}

function findBackupCodeIndex(userId: string, hashes: string[], code: string): number {
  const target = Buffer.from(hashBackupCode(userId, code), "hex");
  let found = -1;
  for (let index = 0; index < hashes.length; index += 1) {
    const candidate = Buffer.from(hashes[index] ?? "", "hex");
    if (candidate.length === target.length && timingSafeEqual(candidate, target)) found = index;
  }
  return found;
}

export type TwoFactorChallenge = {
  requiresTwoFactor: true;
  challengeToken: string;
  expiresInSeconds: number;
};

export function createTwoFactorChallenge(
  userId: string,
  now: Date = new Date(),
): TwoFactorChallenge {
  const payload = Buffer.from(
    JSON.stringify({
      sub: userId,
      purpose: "login-2fa",
      exp: Math.floor(now.getTime() / 1000) + TWO_FACTOR_CHALLENGE_TTL_SECONDS,
    }),
  ).toString("base64url");
  const signature = createHmac("sha256", challengeKey()).update(payload).digest("base64url");
  return {
    requiresTwoFactor: true,
    challengeToken: `${payload}.${signature}`,
    expiresInSeconds: TWO_FACTOR_CHALLENGE_TTL_SECONDS,
  };
}

export function verifyTwoFactorChallenge(
  token: string,
  now: Date = new Date(),
): { userId: string } {
  const [payload, signature] = token.split(".");
  if (!payload || !signature) {
    throw new HttpError(401, "INVALID_2FA_CHALLENGE", "Challenge 2FA tidak valid");
  }
  const expected = createHmac("sha256", challengeKey()).update(payload).digest("base64url");
  const actualBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (
    actualBuffer.length !== expectedBuffer.length ||
    !timingSafeEqual(actualBuffer, expectedBuffer)
  ) {
    throw new HttpError(401, "INVALID_2FA_CHALLENGE", "Challenge 2FA tidak valid");
  }
  let parsed: { sub?: unknown; purpose?: unknown; exp?: unknown };
  try {
    parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    throw new HttpError(401, "INVALID_2FA_CHALLENGE", "Challenge 2FA tidak valid");
  }
  if (
    parsed.purpose !== "login-2fa" ||
    typeof parsed.sub !== "string" ||
    typeof parsed.exp !== "number" ||
    parsed.exp <= Math.floor(now.getTime() / 1000)
  ) {
    throw new HttpError(401, "INVALID_2FA_CHALLENGE", "Challenge 2FA sudah kedaluwarsa");
  }
  return { userId: parsed.sub };
}

export async function isTwoFactorEnabled(userId: string): Promise<boolean> {
  // SYSTEM: konfigurasi keamanan user platform-level.
  const user = await systemDb().user.findUnique({
    where: { id: userId },
    select: { twoFactorEnabled: true },
  });
  return user?.twoFactorEnabled === true;
}

export type SetupTwoFactorResult = {
  secret: string;
  otpauthUri: string;
  backupCodes: string[];
};

export async function setupTwoFactor(input: {
  userId: string;
  tenantId?: string | null;
  memberId?: string | null;
  ip?: string | null;
  userAgent?: string | null;
}): Promise<SetupTwoFactorResult> {
  const db = systemDb();
  const user = await db.user.findUnique({ where: { id: input.userId } });
  if (!user) throw new HttpError(401, "UNAUTHENTICATED", "User tidak ditemukan");
  if (user.twoFactorEnabled) {
    throw new HttpError(409, "TWO_FACTOR_ALREADY_ENABLED", "2FA sudah aktif");
  }
  const secret = generateTotpSecret();
  const backupCodes = generateBackupCodes();
  await db.user.update({
    where: { id: user.id },
    data: {
      twoFactorSecret: encryptTwoFactorSecret(secret),
      twoFactorEnabled: false,
      twoFactorBackupCodesHash: backupCodes.map((code) => hashBackupCode(user.id, code)),
    },
  });
  await audit(input, "auth.two_factor_setup", user.id);
  return { secret, otpauthUri: otpauthUri({ secret, email: user.email }), backupCodes };
}

export async function verifyTwoFactorSetup(input: {
  userId: string;
  code: string;
  tenantId?: string | null;
  memberId?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  now?: Date;
}): Promise<{ enabled: true }> {
  const db = systemDb();
  const user = await db.user.findUnique({ where: { id: input.userId } });
  if (!user?.twoFactorSecret) {
    throw new HttpError(409, "TWO_FACTOR_NOT_SETUP", "Mulai setup 2FA terlebih dahulu");
  }
  if (user.twoFactorEnabled) {
    throw new HttpError(409, "TWO_FACTOR_ALREADY_ENABLED", "2FA sudah aktif");
  }
  let secret: string;
  try {
    secret = decryptTwoFactorSecret(user.twoFactorSecret);
  } catch {
    throw new HttpError(500, "TWO_FACTOR_SECRET_INVALID", "Secret 2FA tidak dapat dibuka");
  }
  if (!verifyTotpCode(secret, input.code, input.now ?? new Date())) {
    throw new HttpError(400, "INVALID_2FA_CODE", "Kode 2FA tidak valid");
  }
  await db.user.update({ where: { id: user.id }, data: { twoFactorEnabled: true } });
  await audit(input, "auth.two_factor_enabled", user.id);
  return { enabled: true };
}

export async function disableTwoFactor(input: {
  userId: string;
  password: string;
  code: string;
  tenantId?: string | null;
  memberId?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  now?: Date;
}): Promise<{ enabled: false }> {
  const db = systemDb();
  const user = await db.user.findUnique({ where: { id: input.userId } });
  if (!user) throw new HttpError(401, "UNAUTHENTICATED", "User tidak ditemukan");
  if (!user.twoFactorEnabled || !user.twoFactorSecret) {
    throw new HttpError(409, "TWO_FACTOR_NOT_ENABLED", "2FA belum aktif");
  }
  if (!(await verifyPassword(user.passwordHash, input.password))) {
    throw new HttpError(401, "INVALID_CREDENTIALS", "Password salah");
  }
  if (!verifyTotpCode(decryptTwoFactorSecret(user.twoFactorSecret), input.code, input.now ?? new Date())) {
    throw new HttpError(401, "INVALID_2FA_CODE", "Kode 2FA tidak valid");
  }
  await db.user.update({
    where: { id: user.id },
    data: {
      twoFactorSecret: null,
      twoFactorEnabled: false,
      twoFactorBackupCodesHash: [],
    },
  });
  await audit(input, "auth.two_factor_disabled", user.id);
  return { enabled: false };
}

export async function verifyLoginSecondFactor(input: {
  userId: string;
  code: string;
  now?: Date;
}): Promise<{ method: "totp" | "backup" }> {
  const db = systemDb();
  const user = await db.user.findUnique({ where: { id: input.userId } });
  if (!user?.twoFactorEnabled || !user.twoFactorSecret) {
    throw new HttpError(401, "INVALID_2FA_CODE", "Kode 2FA tidak valid");
  }
  const now = input.now ?? new Date();
  if (verifyTotpCode(decryptTwoFactorSecret(user.twoFactorSecret), input.code, now)) {
    return { method: "totp" };
  }
  const stored = user.twoFactorBackupCodesHash;
  const hashes = Array.isArray(stored)
    ? stored.filter((value): value is string => typeof value === "string")
    : [];
  const index = findBackupCodeIndex(user.id, hashes, input.code);
  if (index < 0) {
    throw new HttpError(401, "INVALID_2FA_CODE", "Kode 2FA tidak valid");
  }
  const remaining = hashes.filter((_, position) => position !== index);
  await db.user.update({
    where: { id: user.id },
    data: { twoFactorBackupCodesHash: remaining },
  });
  return { method: "backup" };
}

async function audit(
  input: {
    userId: string;
    tenantId?: string | null;
    memberId?: string | null;
    ip?: string | null;
    userAgent?: string | null;
  },
  action: string,
  resourceId: string,
): Promise<void> {
  if (!input.tenantId) return;
  try {
    await writeAudit({
      tenantId: input.tenantId,
      actorType: "USER",
      actorUserId: input.userId,
      actorMemberId: input.memberId ?? null,
      action,
      resourceType: "user",
      resourceId,
      metadata: { method: "totp" },
      ip: input.ip ?? null,
      userAgent: input.userAgent ?? null,
    });
  } catch (error) {
    logger.error("2fa audit failed", { action, error });
  }
}
