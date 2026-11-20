import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

/**
 * Cari root monorepo dengan menelusuri ke atas dari cwd. Pendekatan runtime
 * ini menghindari `new URL(...)` statis yang gagal di-resolve Turbopack saat
 * aplikasi web di-bundle.
 */
function findProjectRoot(start: string): string {
  let current = resolve(start);
  for (let depth = 0; depth < 8; depth += 1) {
    if (existsSync(join(current, "package.json")) && existsSync(join(current, "apps"))) {
      return current;
    }
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return resolve(start);
}

const projectRoot = findProjectRoot(process.cwd());

// Muat .env root proyek bila ada. Tidak menimpa env proses dan tidak gagal
// bila file tidak ada.
for (const name of [".env", ".env.test"]) {
  const candidate = join(projectRoot, name);
  if (!existsSync(candidate)) continue;
  try {
    process.loadEnvFile(candidate);
  } catch {
    // Env yang tidak bisa dibaca bukan alasan menghentikan proses.
  }
}

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Environment variable ${name} wajib diisi`);
  }
  return value;
}
