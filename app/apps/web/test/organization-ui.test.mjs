import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(`../src/app/${path}`, import.meta.url), "utf8");
}

test("organisasi: halaman admin, CRUD, dan navigasi terhubung", () => {
  const page = read("workspaces/[id]/settings/organization/page.tsx");
  const manager = read("workspaces/[id]/settings/organization/organization-manager.tsx");
  const sidebar = read("workspaces/[id]/workspace-sidebar.tsx");

  assert.match(page, /requirePagePermission\("member\.read"\)/);
  assert.match(page, /listDivisions/);
  assert.match(page, /listPositions/);
  assert.match(manager, /\/api\/workspaces\/\$\{workspaceId\}\/divisions/);
  assert.match(manager, /\/api\/workspaces\/\$\{workspaceId\}\/positions/);
  assert.match(manager, /"DELETE"/);
  assert.match(manager, /role="alert"/);
  assert.match(manager, /className="num"/);
  assert.match(sidebar, /settings\/organization/);
  assert.match(sidebar, /organization: "Divisi & jabatan"/);
});

test("organisasi: penugasan karyawan dan filter laporan memakai divisi", () => {
  const memberAdmin = read("workspaces/[id]/members/member-admin.tsx");
  const memberPage = read("workspaces/[id]/members/page.tsx");
  const reports = read("workspaces/[id]/reports/page.tsx");

  assert.match(memberAdmin, /members\/\$\{memberId\}\/organization/);
  assert.match(memberAdmin, /divisi & jabatan|Divisi & jabatan/i);
  assert.match(memberAdmin, /canManageOrganization/);
  assert.match(memberPage, /listDivisions/);
  assert.match(memberPage, /listPositions/);
  assert.match(reports, /divisionId/);
  assert.match(reports, /divisionName/);
  assert.match(reports, /Semua divisi/);
});
