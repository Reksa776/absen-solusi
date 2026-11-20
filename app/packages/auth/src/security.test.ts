import assert from "node:assert/strict";
import test from "node:test";

import {
  createLogger,
  LOG_REDACTED,
  redactLogString,
  redactLogValue,
} from "./logger.js";
import { cacheControlFor, HSTS_HEADER, securityHeaders } from "./security-headers.js";
import { assertPublicCsrf } from "./users.js";
import { errorResponse, getClientIp, HttpError } from "./http.js";

test("F1: header keamanan lengkap pada respons halaman dan API", () => {
  for (const isProduction of [false, true]) {
    const headers = securityHeaders(isProduction, "nonce-uji");
    assert.match(headers["Content-Security-Policy"] ?? "", /frame-ancestors 'none'/);
    assert.match(headers["Content-Security-Policy"] ?? "", /default-src 'self'/);
    assert.match(headers["Content-Security-Policy"] ?? "", /script-src[^;]*'nonce-nonce-uji'/);
    assert.doesNotMatch(headers["Content-Security-Policy"] ?? "", /script-src[^;]*'unsafe-inline'/);
    assert.equal(headers["X-Content-Type-Options"], "nosniff");
    assert.equal(headers["X-Frame-Options"], "DENY");
    assert.equal(headers["Referrer-Policy"], "strict-origin-when-cross-origin");
    assert.match(headers["Permissions-Policy"] ?? "", /camera=\(\)/);
    if (isProduction) assert.equal(headers["Strict-Transport-Security"], HSTS_HEADER);
    else assert.equal(headers["Strict-Transport-Security"], undefined);
  }
});

test("F2: Cache-Control no-store hanya untuk route API", () => {
  assert.equal(cacheControlFor("/api"), "no-store");
  assert.equal(cacheControlFor("/api/auth/login"), "no-store");
  assert.equal(cacheControlFor("/"), null);
  assert.equal(cacheControlFor("/sign-in"), null);
});

test("F3: logger meredaksi password, token, cookie, authorization, session, dan hash", () => {
  const lines: string[] = [];
  const logger = createLogger((line) => lines.push(line));
  const argonHash = "$argon2id$v=19$m=19456,t=2,p=1$c2FsdA$hashhashhash";
  const sha256 = "a".repeat(64);

  logger.error("login gagal", {
    email: "user@example.com",
    password: "super-rahasia",
    token: "abc.def.ghi",
    authorization: "Bearer token-mobile",
    cookie: "__Host-aos_session=token-cookie",
    sessionId: "session-123",
    tokenHash: sha256,
    hash: argonHash,
    nested: { password: "nested-password" },
  });
  logger.info(`request dengan header Authorization: Bearer abc123 dan cookie aos_session=zzz`);

  const output = lines.join("\n");
  for (const secret of [
    "super-rahasia",
    "abc.def.ghi",
    "token-mobile",
    "token-cookie",
    "session-123",
    "nested-password",
    argonHash,
    sha256,
    "abc123",
    "aos_session=zzz",
  ]) {
    assert.equal(output.includes(secret), false, `secret bocor ke log: ${secret}`);
  }
  assert.equal(output.includes(LOG_REDACTED), true);
  assert.equal(output.includes("user@example.com"), true);
});

test("F4: redaksi string menangani Bearer, cookie sesi, dan hash", () => {
  const redacted = redactLogString(
    "Authorization: Bearer rahasia123; Cookie: aos_session=xyz; hash=" + "b".repeat(64),
  );
  assert.equal(redacted.includes("rahasia123"), false);
  assert.equal(redacted.includes("xyz"), false);
  assert.equal(redacted.includes("b".repeat(64)), false);
});

test("F5: redactLogValue menangani Error tanpa membocorkan pesan sensitif", () => {
  const value = redactLogValue(new Error("gagal dengan token=rahasia")) as {
    message: string;
    stack?: string;
  };
  assert.equal(value.message.includes("rahasia"), false);
});

test("F6: login bearer eksplisit tidak membutuhkan Authorization dummy", () => {
  const bearerLogin = new Request("http://localhost/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json", "x-auth-mode": "bearer" },
    body: "{}",
  });
  assert.doesNotThrow(() => assertPublicCsrf(bearerLogin, { allowBearerMode: true }));

  const cookieLogin = new Request("http://localhost/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  });
  assert.throws(
    () => assertPublicCsrf(cookieLogin, { allowBearerMode: true }),
    (error: unknown) => error instanceof HttpError && error.status === 403,
  );
});

test("F8: respons 429 membawa Retry-After", () => {
  const response = errorResponse(new HttpError(429, "RATE_LIMITED", "terlalu banyak", 42));
  assert.equal(response.status, 429);
  assert.equal(response.headers.get("Retry-After"), "42");
});

test("F7: XFF tidak dipercaya tanpa TRUST_PROXY; rightmost dipakai saat aktif", () => {
  const previous = process.env.TRUST_PROXY;
  const request = new Request("http://localhost/api/test", {
    headers: {
      "x-forwarded-for": "203.0.113.10, 198.51.100.20",
      "x-real-ip": "192.0.2.30",
    },
  });
  try {
    delete process.env.TRUST_PROXY;
    assert.equal(getClientIp(request, "10.0.0.5"), "10.0.0.5");
    assert.equal(getClientIp(request), "unknown");

    process.env.TRUST_PROXY = "false";
    assert.equal(getClientIp(request, "10.0.0.5"), "10.0.0.5");

    process.env.TRUST_PROXY = "true";
    assert.equal(getClientIp(request, "10.0.0.5"), "198.51.100.20");
  } finally {
    if (previous === undefined) delete process.env.TRUST_PROXY;
    else process.env.TRUST_PROXY = previous;
  }
});
