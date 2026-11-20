import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { defineConfig } from "prisma/config";

// Prisma 7 tidak memuat .env otomatis; muat .env root proyek bila ada.
const envFile = new URL("../../.env", import.meta.url);
if (existsSync(envFile)) {
  try {
    process.loadEnvFile(fileURLToPath(envFile));
  } catch {
    // Abaikan: env bisa datang dari proses induk.
  }
}

const fallbackUrl = "mysql://placeholder:placeholder@127.0.0.1:3306/absensi_dev";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: process.env.DATABASE_URL ?? fallbackUrl,
  },
});
