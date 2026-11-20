import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(`../src/app/${path}`, import.meta.url), "utf8");
}

test("P5 UI: halaman hari libur memakai workspace.manage dan form CRUD", () => {
  const page = read("workspaces/[id]/settings/holidays/page.tsx");
  const manager = read("workspaces/[id]/settings/holidays/holiday-manager.tsx");
  assert.match(page, /requirePagePermission\("workspace\.manage"\)/);
  assert.match(page, /listHolidays/);
  assert.match(manager, /\/api\/workspaces\/\$\{workspaceId\}\/holidays`/);
  assert.match(manager, /"DELETE"/);
  assert.match(manager, /role="alert"/);
  assert.match(manager, /type="date"/);
});
