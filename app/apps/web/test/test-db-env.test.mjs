import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

const setupScript = fileURLToPath(
  new URL("../../../scripts/test-db-setup.mjs", import.meta.url),
);
const root = fileURLToPath(new URL("../../../", import.meta.url));

test("setup test DB memberi pesan jelas saat env admin tidak tersedia", () => {
  const env = { ...process.env, S1_TEST_DB_SKIP_DOTENV: "1", NODE_ENV: "test" };
  delete env.S1_TEST_SETUP_URL;
  delete env.S1_TEST_ADMIN_URL;
  delete env.DATABASE_URL;

  const result = spawnSync(process.execPath, [setupScript], {
    cwd: root,
    env,
    encoding: "utf8",
  });

  assert.notEqual(result.status, 0);
  const output = `${result.stdout}\n${result.stderr}`;
  assert.match(output, /S1_TEST_ADMIN_URL/);
  assert.match(output, /DATABASE_URL/);
  assert.match(output, /mysql:\/\//);
  assert.doesNotMatch(output, /password@127\.0\.0\.1:3306\/(?:absensi|prod)/i);
});
