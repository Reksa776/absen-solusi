import assert from "node:assert/strict";
import test from "node:test";

import {
  createTwoFactorChallenge,
  decryptTwoFactorSecret,
  encryptTwoFactorSecret,
  generateTotpCode,
  hashBackupCode,
  normalizeBackupCode,
  verifyTwoFactorChallenge,
  verifyTotpCode,
} from "./two-factor.js";

process.env.TWO_FACTOR_ENCRYPTION_KEY = "a".repeat(64);

const RFC_SECRET = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";

test("2FA-T1: TOTP cocok dengan vektor RFC 6238 (SHA-1, 6 digit)", () => {
  const vectors: Array<[number, string]> = [
    [59, "287082"],
    [1_111_111_109, "081804"],
    [1_111_111_111, "050471"],
    [1_234_567_890, "005924"],
    [2_000_000_000, "279037"],
    [20_000_000_000, "353130"],
  ];
  for (const [seconds, expected] of vectors) {
    const now = new Date(seconds * 1000);
    assert.equal(generateTotpCode(RFC_SECRET, now), expected);
    assert.equal(verifyTotpCode(RFC_SECRET, expected, now), true);
  }
  assert.equal(verifyTotpCode(RFC_SECRET, "123456", new Date(59_000)), false);
  assert.equal(verifyTotpCode(RFC_SECRET, "abc", new Date(59_000)), false);
});

test("2FA-T2: jendela toleransi satu langkah menerima kode sebelumnya", () => {
  const previous = generateTotpCode(RFC_SECRET, new Date(29_000));
  assert.equal(verifyTotpCode(RFC_SECRET, previous, new Date(59_000)), true);
  assert.equal(verifyTotpCode(RFC_SECRET, previous, new Date(89_000)), false);
});

test("2FA-T3: secret terenkripsi AES-GCM dan tidak mengandung plaintext", () => {
  const secret = "JBSWY3DPEHPK3PXP";
  const encrypted = encryptTwoFactorSecret(secret);
  assert.match(encrypted, /^v1\./);
  assert.equal(encrypted.includes(secret), false);
  assert.equal(decryptTwoFactorSecret(encrypted), secret);
  assert.throws(() => decryptTwoFactorSecret(`${encrypted.slice(0, -2)}aa`));
});

test("2FA-T4: hash backup code ternormalisasi dan challenge menolak manipulasi/kedaluwarsa", () => {
  assert.equal(normalizeBackupCode(" abcd-efgh "), "ABCDEFGH");
  assert.equal(
    hashBackupCode("user-1", "ABCD-EFGH"),
    hashBackupCode("user-1", "abcde fgh"),
  );
  assert.notEqual(hashBackupCode("user-1", "ABCD-EFGH"), hashBackupCode("user-2", "ABCD-EFGH"));

  const now = new Date("2026-11-20T00:00:00.000Z");
  const challenge = createTwoFactorChallenge("user-1", now);
  assert.equal(challenge.requiresTwoFactor, true);
  assert.equal(verifyTwoFactorChallenge(challenge.challengeToken, now).userId, "user-1");
  assert.throws(() =>
    verifyTwoFactorChallenge(`${challenge.challengeToken.slice(0, -1)}x`, now),
  );
  assert.throws(() =>
    verifyTwoFactorChallenge(
      challenge.challengeToken,
      new Date(now.getTime() + (challenge.expiresInSeconds + 1) * 1000),
    ),
  );
});
