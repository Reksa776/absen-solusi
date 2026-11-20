#!/usr/bin/env node
/**
 * Menyiapkan database test terisolasi untuk seluruh suite.
 *
 * Sumber kredensial setup (berurutan): S1_TEST_SETUP_URL, S1_TEST_ADMIN_URL,
 * atau DATABASE_URL di file .env. Nilai DATABASE_URL dari environment runtime
 * sengaja TIDAK dipakai agar .env.test tidak bocor menjadi kredensial setup.
 *
 * Script tidak pernah DROP USER. User test dibuat bila belum ada dan password
 * dirotasi dengan ALTER USER. Untuk lingkungan yang hanya boleh memakai user
 * test yang sudah ada, set S1_TEST_REUSE_USERS=1 dan sediakan
 * S1_TEST_ADMIN_RUNTIME_URL + S1_TEST_APP_RUNTIME_URL (atau .env.test lama).
 * Script tetap DROP/CREATE DATABASE dan memberi grant; user DDL dilewati.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import mariadb from "mariadb";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const root = resolve(scriptDir, "..");

function readDotEnv(path) {
  if (!existsSync(path)) return {};
  const values = {};
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const index = trimmed.indexOf("=");
    if (index <= 0) continue;
    const key = trimmed.slice(0, index).trim();
    let value = trimmed.slice(index + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    values[key] = value;
  }
  return values;
}

const dotenv = process.env.S1_TEST_DB_SKIP_DOTENV === "1" ? {} : readDotEnv(join(root, ".env"));
const setupUrl =
  process.env.S1_TEST_SETUP_URL ??
  dotenv.S1_TEST_SETUP_URL ??
  process.env.S1_TEST_ADMIN_URL ??
  dotenv.S1_TEST_ADMIN_URL ??
  dotenv.DATABASE_URL;
if (!setupUrl) {
  throw new Error(
    "Environment test DB belum lengkap: set S1_TEST_SETUP_URL (disarankan), " +
      "S1_TEST_ADMIN_URL, atau DATABASE_URL di .env. Contoh: " +
      "S1_TEST_SETUP_URL=mysql://setup:password@127.0.0.1:3306/ " +
      "(jangan gunakan kredensial produksi; database test dibuat otomatis).",
  );
}

const parsed = new URL(setupUrl);
if (parsed.protocol !== "mysql:" && parsed.protocol !== "mariadb:") {
  throw new Error("URL admin test harus mysql:// atau mariadb://");
}
const host = process.env.S1_TEST_DB_HOST ?? parsed.hostname;
const port = Number(process.env.S1_TEST_DB_PORT ?? (parsed.port || 3306));
const database = process.env.S1_TEST_DB_NAME ?? "absensi_s1_verify_ci";
if (!/^absensi_s1_verify_[a-z0-9]+$/.test(database)) {
  throw new Error("Nama database test harus absensi_s1_verify_<suffix>");
}
const envFilePath = process.env.S1_TEST_ENV_FILE ?? join(root, ".env.test");
const skipMigrations = process.env.S1_TEST_SKIP_MIGRATIONS === "1";
const grantOnly = process.env.S1_TEST_GRANT_ONLY === "1";
const setupUser = process.env.S1_TEST_SETUP_USER ?? decodeURIComponent(parsed.username);
const setupPassword = process.env.S1_TEST_SETUP_PASSWORD ?? decodeURIComponent(parsed.password);
const appUser = "s1_app_ci";
const adminTestUser = "s1_admin_ci";
const appPassword = randomBytes(24).toString("hex");
const adminTestPassword = randomBytes(24).toString("hex");

const quoteIdent = (value) => `\`${value.replaceAll("`", "``")}\``;
const quoteString = (value) => `'${value.replaceAll("\\", "\\\\").replaceAll("'", "\\'")}'`;

/** Grant per tabel; audit_logs tetap append-only untuk akun runtime. */
async function grantRuntimePrivileges(connection, targetDatabase, targetHost) {
  const rows = await connection.query(
    "SELECT table_name AS tableName FROM information_schema.tables WHERE table_schema = ?",
    [targetDatabase],
  );
  for (const row of rows) {
    const table = String(row.tableName);
    if (table === "_prisma_migrations" || table === "audit_logs") continue;
    await connection.query(
      `GRANT SELECT, INSERT, UPDATE, DELETE ON ${quoteIdent(targetDatabase)}.${quoteIdent(
        table,
      )} TO ${quoteString(appUser)}@${quoteString(targetHost)}`,
    );
  }
  await connection.query(
    `GRANT SELECT, INSERT ON ${quoteIdent(targetDatabase)}.${quoteIdent(
      "audit_logs",
    )} TO ${quoteString(appUser)}@${quoteString(targetHost)}`,
  );
}

/** Mode 3: grant ulang setelah worktree menerapkan migrasi milik tag lama. */
if (grantOnly) {
  const values = readDotEnv(envFilePath);
  const runtimeAdminUrl = values.DATABASE_URL;
  if (!runtimeAdminUrl) {
    throw new Error(`S1_TEST_GRANT_ONLY=1 memerlukan DATABASE_URL di ${envFilePath}`);
  }
  const url = new URL(runtimeAdminUrl);
  const targetHost = process.env.S1_TEST_DB_HOST ?? url.hostname;
  const targetDatabase = process.env.S1_TEST_DB_NAME ?? url.pathname.replace(/^\//, "");
  // GRANT butuh kredensial setup, bukan user admin runtime (yang hanya punya
  // ALL pada database-nya, tanpa hak global GRANT).
  const connection = await mariadb.createConnection({
    host,
    port,
    user: setupUser,
    password: setupPassword,
    database: targetDatabase,
  });
  try {
    await grantRuntimePrivileges(connection, targetDatabase, targetHost);
  } finally {
    await connection.end();
  }
  console.log(`test_db_granted name=${targetDatabase}`);
  process.exit(0);
}

function parseRuntimeUrls() {
  const previous = readDotEnv(join(root, ".env.test"));
  const adminUrl =
    process.env.S1_TEST_ADMIN_RUNTIME_URL ??
    previous.S1_TEST_ADMIN_RUNTIME_URL ??
    previous.DATABASE_URL;
  const appUrl =
    process.env.S1_TEST_APP_RUNTIME_URL ??
    previous.S1_TEST_APP_RUNTIME_URL ??
    previous.APP_DATABASE_URL;
  if (!adminUrl || !appUrl) {
    throw new Error(
      "S1_TEST_REUSE_USERS=1 memerlukan S1_TEST_ADMIN_RUNTIME_URL dan " +
        "S1_TEST_APP_RUNTIME_URL, atau .env.test lama dengan DATABASE_URL/APP_DATABASE_URL.",
    );
  }
  const retarget = (label, raw) => {
    const url = new URL(raw);
    if (!url.username || !url.password) {
      throw new Error(`${label} harus memuat user dan password`);
    }
    url.pathname = `/${database}`;
    return url.toString();
  };
  return {
    adminUrl: retarget("admin runtime", adminUrl),
    appUrl: retarget("app runtime", appUrl),
  };
}

const reuseUsers = process.env.S1_TEST_REUSE_USERS === "1";
let adminUrl;
let appUrl;

if (reuseUsers) {
  ({ adminUrl, appUrl } = parseRuntimeUrls());
}

const setup = await mariadb.createConnection({
  host,
  port,
  user: setupUser,
  password: setupPassword,
  multipleStatements: false,
});
try {
  await setup.query(`DROP DATABASE IF EXISTS ${quoteIdent(database)}`);
  await setup.query(
    `CREATE DATABASE ${quoteIdent(database)} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
  );
  if (!reuseUsers) {
    const users = await setup.query(
      "SELECT User FROM mysql.user WHERE User IN (?, ?) AND Host = ?",
      [adminTestUser, appUser, host],
    );
    const existing = new Set(users.map((row) => String(row.User)));
    for (const user of [adminTestUser, appUser]) {
      if (!existing.has(user)) {
        await setup.query(
          `CREATE USER ${quoteString(user)}@${quoteString(host)} IDENTIFIED BY ${quoteString(
            user === appUser ? appPassword : adminTestPassword,
          )}`,
        );
      } else {
        await setup.query(
          `ALTER USER ${quoteString(user)}@${quoteString(host)} IDENTIFIED BY ${quoteString(
            user === appUser ? appPassword : adminTestPassword,
          )}`,
        );
      }
    }
    await setup.query(
      `GRANT ALL PRIVILEGES ON ${quoteIdent(database)}.* TO ${quoteString(adminTestUser)}@${quoteString(host)}`,
    );
    const encodedHost = host.includes(":") ? `[${host}]` : host;
    adminUrl = `mysql://${encodeURIComponent(adminTestUser)}:${encodeURIComponent(
      adminTestPassword,
    )}@${encodedHost}:${port}/${database}`;
    appUrl = `mysql://${encodeURIComponent(appUser)}:${encodeURIComponent(
      appPassword,
    )}@${encodedHost}:${port}/${database}`;
  } else {
    const runtimeAdminUser = decodeURIComponent(new URL(adminUrl).username);
    await setup.query(
      `GRANT ALL PRIVILEGES ON ${quoteIdent(database)}.* TO ${quoteString(
        runtimeAdminUser,
      )}@${quoteString(host)}`,
    );
  }
} finally {
  await setup.end();
}

if (!skipMigrations) {
  execFileSync("npx", ["prisma", "migrate", "deploy"], {
    cwd: join(root, "packages", "database"),
    env: { ...process.env, DATABASE_URL: adminUrl, APP_DATABASE_URL: appUrl },
    stdio: "inherit",
  });

  const grantAdmin = await mariadb.createConnection({
    host,
    port,
    user: setupUser,
    password: setupPassword,
    database,
  });
  try {
    await grantRuntimePrivileges(grantAdmin, database, host);
  } finally {
    await grantAdmin.end();
  }
}

const envTest = [
  `DATABASE_URL=${quoteString(adminUrl)}`,
  `APP_DATABASE_URL=${quoteString(appUrl)}`,
  "S1_TEST_DB_GUARD=1",
  `S1_TEST_DB_NAME=${database}`,
  `S1_TEST_DB_HOST=${host}`,
  `S1_TEST_DB_PORT=${port}`,
  "",
].join("\n");
mkdirSync(dirname(envFilePath), { recursive: true });
writeFileSync(envFilePath, envTest, { mode: 0o600 });

console.log(
  `test_db_ready name=${database} host=${host} port=${port} users=${reuseUsers ? "reused" : "upserted"} migrations=${skipMigrations ? "skipped" : "deployed"}`,
);
