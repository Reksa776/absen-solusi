import assert from "node:assert/strict";
import test from "node:test";

import {
  enforceRegisterRateLimit,
  MemoryRateLimiter,
  REGISTER_RATE_LIMIT,
  UnavailableRateLimiter,
} from "./rate-limit.js";

test("RL-1: pendaftaran dibatasi per IP dan permintaan berlebih ditolak 429", async () => {
  // Satu limiter memakai tanggal tetap agar window tidak bergeser saat test.
  const limiter = new MemoryRateLimiter();
  const now = new Date("2026-11-23T10:00:00Z");
  for (let index = 0; index < REGISTER_RATE_LIMIT; index += 1) {
    const allowed = await enforceRegisterRateLimit({ ip: "203.0.113.7", limiter, now });
    assert.equal(allowed.allowed, true);
  }
  const denied = await enforceRegisterRateLimit({ ip: "203.0.113.7", limiter, now });
  assert.equal(denied.allowed, false);
  if (!denied.allowed) {
    assert.equal(denied.status, 429);
    assert.ok(denied.retryAfterSeconds > 0);
  }
});

test("RL-2: bucket pendaftaran terpisah per IP", async () => {
  const limiter = new MemoryRateLimiter();
  for (let index = 0; index < REGISTER_RATE_LIMIT; index += 1) {
    await enforceRegisterRateLimit({ ip: "198.51.100.1", limiter });
  }
  const otherIp = await enforceRegisterRateLimit({ ip: "198.51.100.2", limiter });
  assert.equal(otherIp.allowed, true);
});

test("RL-3: backend limiter gagal membuat pendaftaran fail-closed 503", async () => {
  const outcome = await enforceRegisterRateLimit({
    ip: "192.0.2.10",
    limiter: new UnavailableRateLimiter(),
  });
  assert.equal(outcome.allowed, false);
  if (!outcome.allowed) {
    assert.equal(outcome.status, 503);
    assert.match(outcome.message, /Rate limiter tidak tersedia/);
  }
});
