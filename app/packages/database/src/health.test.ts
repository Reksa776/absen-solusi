import assert from "node:assert/strict";
import test from "node:test";

import { ALL_PERMISSIONS } from "@absensi/permissions";

import type { PrismaClient } from "./generated/prisma/client.js";
import { checkReadiness } from "./health.js";

type FakeOptions = {
  databaseUp?: boolean;
  permissionKeys?: string[];
};

function client(options: FakeOptions = {}): PrismaClient {
  const databaseUp = options.databaseUp ?? true;
  const keys = [...(options.permissionKeys ?? ALL_PERMISSIONS)];
  return {
    $queryRaw: async () => {
      if (!databaseUp) throw new Error("Access denied for user 'root'@'10.0.0.5'");
      return [{ "1": 1 }];
    },
    permission: {
      findMany: async () => keys.map((key) => ({ key })),
    },
  } as unknown as PrismaClient;
}

test("K1: readiness ready saat database dan katalog permission lengkap", async () => {
  const report = await checkReadiness(client());
  assert.deepEqual(report, {
    status: "ready",
    checks: {
      database: "up",
      permissions: "ok",
      permissionCount: ALL_PERMISSIONS.length,
      missingPermissions: [],
    },
  });
});

test("K2: readiness not_ready saat database gagal, tanpa detail internal", async () => {
  const report = await checkReadiness(client({ databaseUp: false }));

  assert.deepEqual(report, {
    status: "not_ready",
    checks: {
      database: "down",
      permissions: "invalid",
      permissionCount: 0,
      missingPermissions: [],
    },
  });

  const serialized = JSON.stringify(report);
  for (const secret of ["Access denied", "root", "10.0.0.5", "error", "stack"]) {
    assert.equal(serialized.includes(secret), false, `readiness membocorkan: ${secret}`);
  }
});

test("K3: katalog kosong → 503-style report dengan daftar permission yang hilang", async () => {
  const report = await checkReadiness(client({ permissionKeys: [] }));
  assert.equal(report.status, "not_ready");
  assert.equal(report.checks.permissions, "invalid");
  assert.equal(report.checks.permissionCount, 0);
  assert.deepEqual(report.checks.missingPermissions, [...ALL_PERMISSIONS]);
  assert.equal(report.checks.missingPermissions.length, ALL_PERMISSIONS.length);
});

test("K4: re-seed katalog mengembalikan readiness ready", async () => {
  const keys: string[] = [];
  const db = client({ permissionKeys: keys });
  assert.equal((await checkReadiness(db)).status, "not_ready");

  keys.push(...ALL_PERMISSIONS);
  // Fake client menyalin array saat dibuat; buat ulang setelah re-seed.
  const reseeded = await checkReadiness(client({ permissionKeys: [...ALL_PERMISSIONS] }));
  assert.equal(reseeded.status, "ready");
  assert.equal(reseeded.checks.permissionCount, ALL_PERMISSIONS.length);
  assert.deepEqual(reseeded.checks.missingPermissions, []);
});
