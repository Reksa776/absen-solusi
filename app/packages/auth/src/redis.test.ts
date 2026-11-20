import assert from "node:assert/strict";
import { createServer, type Server, type Socket } from "node:net";
import test from "node:test";

import { HttpError } from "./http.js";
import {
  API_RATE_LIMIT,
  enforceUserRateLimit,
  MemoryRateLimiter,
  RedisRateLimiter,
  WORKSPACE_MUTATION_RATE_LIMIT,
} from "./rate-limit.js";

function parseIncoming(
  buffer: Buffer,
  offset = 0,
): { value: string[]; next: number } | null {
  if (buffer.length <= offset + 1) return null;
  if (buffer[offset] !== 42) return null; // '*'
  const lineEnd = buffer.indexOf("\r\n", offset);
  if (lineEnd < 0) return null;
  const count = Number(buffer.subarray(offset + 1, lineEnd).toString());
  const values: string[] = [];
  let cursor = lineEnd + 2;
  for (let index = 0; index < count; index += 1) {
    const valueEnd = buffer.indexOf("\r\n", cursor);
    if (valueEnd < 0) return null;
    const length = Number(buffer.subarray(cursor + 1, valueEnd).toString());
    const start = valueEnd + 2;
    if (buffer.length < start + length + 2) return null;
    values.push(buffer.subarray(start, start + length).toString());
    cursor = start + length + 2;
  }
  return { value: values, next: cursor };
}

async function startFakeRedis(): Promise<{ url: string; close: () => Promise<void> }> {
  const buckets = new Map<string, { count: number; resetAt: number }>();
  const sockets = new Set<Socket>();
  const server: Server = createServer((socket) => {
    sockets.add(socket);
    let buffer = Buffer.alloc(0);
    socket.on("data", (chunk) => {
      buffer = Buffer.concat([buffer, Buffer.from(chunk)]);
      while (true) {
        const parsed = parseIncoming(buffer);
        if (!parsed) break;
        buffer = buffer.subarray(parsed.next);
        const [command, ...args] = parsed.value;
        if (command === "PING") {
          socket.write("+PONG\r\n");
        } else if (command === "EVAL") {
          const key = args[2] ?? "";
          const windowMs = Number(args[3] ?? 60000);
          const now = Date.now();
          const current = buckets.get(key);
          const bucket =
            !current || current.resetAt <= now
              ? { count: 0, resetAt: now + windowMs }
              : current;
          bucket.count += 1;
          buckets.set(key, bucket);
          socket.write(`*2\r\n:${bucket.count}\r\n:${Math.max(0, bucket.resetAt - now)}\r\n`);
        } else {
          socket.write(`-ERR unknown command ${command}\r\n`);
        }
      }
    });
    socket.on("close", () => sockets.delete(socket));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("fake redis tidak listen");
  return {
    url: `redis://127.0.0.1:${address.port}`,
    close: async () => {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

test("B4-1: Redis atomik dan konsisten lintas dua instance", async () => {
  const fake = await startFakeRedis();
  const first = new RedisRateLimiter(fake.url);
  const second = new RedisRateLimiter(fake.url);
  try {
    assert.equal((await first.consume("api:user:u1", 2, 60_000)).allowed, true);
    assert.equal((await second.consume("api:user:u1", 2, 60_000)).allowed, true);
    const blocked = await first.consume("api:user:u1", 2, 60_000);
    assert.equal(blocked.allowed, false);
    assert.ok(blocked.retryAfterSeconds >= 1);
    assert.equal((await second.consume("api:user:u2", 2, 60_000)).allowed, true);
  } finally {
    first.close();
    second.close();
    await fake.close();
  }
});

test("B4-2: Redis mati → 503 fail-closed, bukan lolos", async () => {
  const limiter = new RedisRateLimiter("redis://127.0.0.1:1");
  const outcome = await enforceUserRateLimit({ userId: "u-dead", bucket: "api", limiter });
  assert.equal(outcome.allowed, false);
  assert.equal(outcome.allowed === false && outcome.status, 503);
  assert.ok(outcome.allowed === false && outcome.retryAfterSeconds >= 1);
  limiter.close();
});

test("B4-3: limit API 300/menit dan workspace 30/menit dengan Retry-After", async () => {
  const limiter = new MemoryRateLimiter();
  for (let index = 0; index < API_RATE_LIMIT; index += 1) {
    const outcome = await enforceUserRateLimit({ userId: "u-api", bucket: "api", limiter });
    assert.equal(outcome.allowed, true);
  }
  const blocked = await enforceUserRateLimit({ userId: "u-api", bucket: "api", limiter });
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.allowed === false && blocked.status, 429);
  assert.ok(blocked.allowed === false && blocked.retryAfterSeconds > 0);
  const response = new (await import("./http.js")).HttpError(
    blocked.allowed === false ? blocked.status : 500,
    "RATE_LIMITED",
    "blocked",
    blocked.allowed === false ? blocked.retryAfterSeconds : 0,
  );
  assert.equal(response.retryAfterSeconds !== undefined, true);

  const writeLimiter = new MemoryRateLimiter();
  for (let index = 0; index < WORKSPACE_MUTATION_RATE_LIMIT; index += 1) {
    const outcome = await enforceUserRateLimit({
      userId: "u-workspace",
      bucket: "workspace.invite",
      limiter: writeLimiter,
    });
    assert.equal(outcome.allowed, true);
  }
  const writeBlocked = await enforceUserRateLimit({
    userId: "u-workspace",
    bucket: "workspace.invite",
    limiter: writeLimiter,
  });
  assert.equal(writeBlocked.allowed, false);
  assert.equal(writeBlocked.allowed === false && writeBlocked.status, 429);
  assert.ok(writeBlocked.allowed === false && writeBlocked.retryAfterSeconds > 0);
  assert.ok(response instanceof HttpError);
});
