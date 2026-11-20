import { Algorithm, hash, verify } from "@node-rs/argon2";

/** Parameter Argon2id sesuai spesifikasi Phase 1 (m=19456 KiB, t=2, p=1). */
export const ARGON2_OPTIONS = {
  algorithm: Algorithm.Argon2id,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
} as const;

export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 128;

export class PasswordPolicyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PasswordPolicyError";
  }
}

export function assertPasswordPolicy(password: string): void {
  if (typeof password !== "string" || password.length < PASSWORD_MIN_LENGTH) {
    throw new PasswordPolicyError(`Password minimal ${PASSWORD_MIN_LENGTH} karakter`);
  }
  if (password.length > PASSWORD_MAX_LENGTH) {
    throw new PasswordPolicyError(`Password maksimal ${PASSWORD_MAX_LENGTH} karakter`);
  }
}

/** Hash Argon2id; encoded hash memuat parameter, sehingga verifikasi mandiri. */
export async function hashPassword(password: string): Promise<string> {
  assertPasswordPolicy(password);
  return hash(password, ARGON2_OPTIONS);
}

/** Verifikasi fail-closed: hash rusak/tidak dikenal dianggap tidak cocok. */
export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  if (!passwordHash || typeof password !== "string") return false;
  try {
    return await verify(passwordHash, password, ARGON2_OPTIONS);
  } catch {
    return false;
  }
}
