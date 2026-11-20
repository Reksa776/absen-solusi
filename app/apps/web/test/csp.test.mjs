import assert from "node:assert/strict";
import test from "node:test";

import { securityHeaders } from "@absensi/auth";

test("B8: script-src tidak memuat unsafe-inline dan memakai nonce", () => {
  const headers = securityHeaders(true, "abc123");
  const csp = headers["Content-Security-Policy"] ?? "";
  assert.match(csp, /script-src 'self' 'nonce-abc123' 'strict-dynamic'/);
  assert.doesNotMatch(csp, /script-src[^;]*'unsafe-inline'/);
  assert.equal(headers["Strict-Transport-Security"] !== undefined, true);
});
