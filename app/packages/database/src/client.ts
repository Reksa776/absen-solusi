import "./env.js";

import { PrismaMariaDb } from "@prisma/adapter-mariadb";

import { PrismaClient } from "./generated/prisma/client.js";

export type AppPrismaClient = PrismaClient;

/**
 * Client runtime memakai akun aplikasi (APP_DATABASE_URL) yang grant-nya
 * dibatasi per tabel: audit_logs hanya SELECT + INSERT.
 */
export function createPrismaClient(databaseUrl?: string): PrismaClient {
  const url = databaseUrl ?? process.env.APP_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!url) {
    throw new Error("APP_DATABASE_URL atau DATABASE_URL wajib diisi");
  }
  const adapter = new PrismaMariaDb(url);
  return new PrismaClient({ adapter });
}

let cached: PrismaClient | undefined;

/**
 * SYSTEM: klien unscoped untuk langkah platform-level (bootstrap user,
 * provisioning workspace yang belum punya tenant, audit writer, test admin).
 * Setiap call site wajib menandai alasannya dengan komentar SYSTEM:.
 */
export function systemDb(): PrismaClient {
  cached ??= createPrismaClient();
  return cached;
}

export async function disconnectPrisma(): Promise<void> {
  if (!cached) return;
  await cached.$disconnect();
  cached = undefined;
}
