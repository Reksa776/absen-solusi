import assert from "node:assert/strict";
import test from "node:test";

import { purgeStaleDeviceTokens } from "./notifications.js";

test("W5: purge token memakai cutoff updated_at dan mengembalikan jumlah terhapus", async () => {
  let captured: { where?: { updatedAt?: { lt?: Date } } } | undefined;
  const client = {
    deviceToken: {
      deleteMany: async (args: { where: { updatedAt: { lt: Date } } }) => {
        captured = args;
        return { count: 3 };
      },
    },
  } as never;
  const now = new Date("2026-11-20T00:00:00.000Z");

  const result = await purgeStaleDeviceTokens({
    olderThanDays: 30,
    now,
    client,
  });

  assert.equal(result.deleted, 3);
  assert.equal(result.cutoff, "2026-10-21T00:00:00.000Z");
  assert.equal(captured?.where?.updatedAt?.lt?.toISOString(), result.cutoff);

  await assert.rejects(
    purgeStaleDeviceTokens({ olderThanDays: 0, now, client }),
    (error: unknown) =>
      typeof error === "object" &&
      error !== null &&
      (error as { code?: string }).code === "INVALID_TOKEN_TTL",
  );
});
