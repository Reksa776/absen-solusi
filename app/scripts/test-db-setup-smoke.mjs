#!/usr/bin/env node
/**
 * Smoke test untuk scripts/test-db-setup.mjs pada lingkungan terbatas.
 *
 * Setup user sementara hanya mendapat CREATE/DROP database dan grant pada
 * database smoke; TIDAK mendapat CREATE USER. Script utama dijalankan dengan
 * S1_TEST_REUSE_USERS=1 memakai user test yang sudah ada. Ini membuktikan setup
 * tidak memerlukan DROP USER.
 */
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, readFileSync, renameSync, rmSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import mariadb from "mariadb";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const envTest = join(root, ".env.test");
const backup = join(root, ".env.test.smoke-backup");

const dotenv = Object.fromEntries(
  [...readFileSync(join(root, ".env"), "utf8").matchAll(/^([A-Z0-9_]+)=(.*)$/gm)].map((match) => [
    match[1],
    match[2].replace(/^['"]|['"]$/g, ""),
  ]),
);
const setupUrl = process.env.S1_TEST_SETUP_URL ?? process.env.S1_TEST_ADMIN_URL ?? dotenv.DATABASE_URL;
if (!setupUrl) throw new Error("S1_TEST_SETUP_URL/S1_TEST_ADMIN_URL/DATABASE_URL .env wajib");
const parsed = new URL(setupUrl);
const host = parsed.hostname;
const port = Number(parsed.port || 3306);
const suffix = randomBytes(3).toString("hex");
const smokeDatabase = `absensi_s1_verify_smoke${suffix}`;
const limitedUser = `s1_setup_limited_${suffix}`;
const limitedPassword = randomBytes(18).toString("hex");
const quote = (value) => `'${value.replaceAll("\\", "\\\\").replaceAll("'", "\\'")}'`;

if (!existsSync(envTest)) {
  execFileSync("node", ["scripts/test-db-setup.mjs"], { cwd: root, stdio: "inherit" });
}
const runtime = Object.fromEntries(
  [...readFileSync(envTest, "utf8").matchAll(/^([A-Z0-9_]+)=(.*)$/gm)].map((match) => [
    match[1],
    match[2].replace(/^['"]|['"]$/g, ""),
  ]),
);
copyFileSync(envTest, backup);

const rootDb = await mariadb.createConnection({
  host,
  port,
  user: decodeURIComponent(parsed.username),
  password: decodeURIComponent(parsed.password),
});
try {
  await rootDb.query(
    `CREATE USER ${quote(limitedUser)}@${quote(host)} IDENTIFIED BY ${quote(limitedPassword)}`,
  );
  await rootDb.query(`GRANT CREATE, DROP ON *.* TO ${quote(limitedUser)}@${quote(host)}`);
  await rootDb.query(
    `GRANT ALL PRIVILEGES ON \`${smokeDatabase}\`.* TO ${quote(limitedUser)}@${quote(host)} WITH GRANT OPTION`,
  );
  const grants = (await rootDb.query(`SHOW GRANTS FOR ${quote(limitedUser)}@${quote(host)}`))
    .map((row) => Object.values(row)[0])
    .join("\n");
  if (/CREATE USER|DROP USER|GRANT OPTION ON \*\.\*/i.test(grants)) {
    throw new Error(`smoke user tidak boleh punya privilege user DDL: ${grants}`);
  }

  const limitedUrl = `mysql://${encodeURIComponent(limitedUser)}:${encodeURIComponent(
    limitedPassword,
  )}@${host}:${port}/`;
  execFileSync("node", ["scripts/test-db-setup.mjs"], {
    cwd: root,
    env: {
      ...process.env,
      S1_TEST_SETUP_URL: limitedUrl,
      S1_TEST_DB_NAME: smokeDatabase,
      S1_TEST_DB_HOST: host,
      S1_TEST_DB_PORT: String(port),
      S1_TEST_REUSE_USERS: "1",
      S1_TEST_ADMIN_RUNTIME_URL: runtime.DATABASE_URL,
      S1_TEST_APP_RUNTIME_URL: runtime.APP_DATABASE_URL,
      S1_TEST_DB_SKIP_DOTENV: "1",
    },
    stdio: "inherit",
  });

  const smoke = await mariadb.createConnection({
    host,
    port,
    database: smokeDatabase,
    user: "s1_admin_ci",
    password: decodeURIComponent(new URL(runtime.DATABASE_URL).password),
  });
  const [{ tables }] = await smoke.query(
    "SELECT COUNT(*) AS tables FROM information_schema.tables WHERE table_schema = ?",
    [smokeDatabase],
  );
  await smoke.end();
  if (Number(tables) < 12) throw new Error(`migration smoke tidak lengkap: ${tables} tabel`);
  console.log(`setup_smoke_pass database=${smokeDatabase} tables=${tables} user_ddl=denied`);
} finally {
  await rootDb.query(`DROP DATABASE IF EXISTS \`${smokeDatabase}\``);
  await rootDb.query(`DROP USER IF EXISTS ${quote(limitedUser)}@${quote(host)}`);
  await rootDb.end();
  if (existsSync(backup)) {
    renameSync(backup, envTest);
  } else {
    rmSync(envTest, { force: true });
  }
}
