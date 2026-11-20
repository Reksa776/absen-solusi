import { ALL_PERMISSIONS, assertPermissionCatalog } from "@absensi/permissions";

import type { PrismaClient } from "./generated/prisma/client.js";
import { systemDb } from "./client.js";

/** Liveness database: satu SELECT 1, tanpa menyentuh tabel tenant. */
export async function checkDatabaseHealth(
  client: PrismaClient = systemDb(),
): Promise<boolean> {
  try {
    await client.$queryRaw`SELECT 1`;
    return true;
  } catch {
    return false;
  }
}

export type ReadinessChecks = {
  database: "up" | "down";
  permissions: "ok" | "invalid";
  permissionCount: number;
  missingPermissions: string[];
};

export type ReadinessReport = {
  status: "ready" | "not_ready";
  checks: ReadinessChecks;
};

/**
 * Readiness: dependency yang benar-benar dipakai route (database) dan
 * konsistensi katalog permission. Pesan error dependency tidak pernah
 * dikembalikan, hanya status up/down.
 */
export async function checkReadiness(
  client: PrismaClient = systemDb(),
): Promise<ReadinessReport> {
  const databaseUp = await checkDatabaseHealth(client);
  let catalogOk = true;
  try {
    assertPermissionCatalog();
  } catch {
    catalogOk = false;
  }

  let permissionCount = 0;
  let missingPermissions: string[] = [];
  if (databaseUp) {
    try {
      const rows = await client.permission.findMany({ select: { key: true } });
      const present = new Set(rows.map((row) => row.key));
      permissionCount = rows.length;
      missingPermissions = ALL_PERMISSIONS.filter((key) => !present.has(key));
    } catch {
      catalogOk = false;
      missingPermissions = [...ALL_PERMISSIONS];
    }
  }
  const permissionsOk = databaseUp && catalogOk && missingPermissions.length === 0;

  const checks: ReadinessChecks = {
    database: databaseUp ? "up" : "down",
    permissions: permissionsOk ? "ok" : "invalid",
    permissionCount,
    missingPermissions,
  };

  return {
    status: databaseUp && permissionsOk ? "ready" : "not_ready",
    checks,
  };
}
