import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { enforceLoginRateLimit, RedisRateLimiter } from "./rate-limit.js";

const REAL_REDIS_URL = process.env.REDIS_REAL_URL;

test(
  "RR-1: dua instance Redis berbagi counter rate limit yang sama",
  { skip: REAL_REDIS_URL ? false : "REDIS_REAL_URL tidak diset" },
  async () => {
    const first = new RedisRateLimiter(REAL_REDIS_URL as string);
    const second = new RedisRateLimiter(REAL_REDIS_URL as string);
    const key = `real-limit:${randomUUID()}`;
    try {
      for (let index = 0; index < 3; index += 1) {
        const decision = await first.consume(key, 3, 60_000);
        assert.equal(decision.allowed, true);
      }
      const denied = await second.consume(key, 3, 60_000);
      assert.equal(denied.allowed, false);
      assert.ok(denied.retryAfterSeconds > 0);
    } finally {
      first.close();
      second.close();
    }
  },
);

test(
  "RR-2: Redis mati membuat login ditolak 503 (fail-closed)",
  { skip: REAL_REDIS_URL ? false : "REDIS_REAL_URL tidak diset" },
  async () => {
    const limiter = new RedisRateLimiter("redis://127.0.0.1:6399");
    try {
      const outcome = await enforceLoginRateLimit({
        ip: "203.0.113.99",
        email: "redis-down@example.com",
        limiter,
      });
      assert.equal(outcome.allowed, false);
      if (!outcome.allowed) {
        assert.equal(outcome.status, 503);
        assert.ok(outcome.retryAfterSeconds >= 1);
      }
    } finally {
      limiter.close();
    }
  },
);
