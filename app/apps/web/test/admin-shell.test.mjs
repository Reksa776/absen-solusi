import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(`../src/app/${path}`, import.meta.url), "utf8");
}

test("B7 UI: halaman workspace memakai permission server dan switcher", () => {
  const page = read("workspaces/page.tsx");
  assert.match(page, /requirePagePermission\(\)/);
  assert.match(page, /WorkspaceSwitcher/);
  assert.match(page, /\/workspaces\/\$\{workspace\.id\}\/members/);
  assert.match(page, /audit\.read/);
});

test("B7 UI: halaman member merender tabel dan form endpoint yang benar", () => {
  const page = read("workspaces/[id]/members/page.tsx");
  const form = read("workspaces/[id]/members/member-admin.tsx");
  assert.match(page, /requirePagePermission\("member\.read"\)/);
  assert.match(page, /listWorkspaceMembers/);
  assert.match(form, /\/api\/workspaces\/\$\{workspaceId\}\/members\/direct/);
  assert.match(form, /\/members\/\$\{editing\.id\}\/employee/);
  assert.doesNotMatch(form, /name=["']role["']/);
  assert.match(form, /"PATCH"/);
  assert.match(form, /Reset Password/);
  assert.match(form, /Tambah Karyawan Langsung/);
  assert.match(form, /role="alert"/);
  assert.match(page, /canResetPassword/);
});

test("B7 UI: audit viewer read-only memakai audit.read dan filter tenant", () => {
  const page = read("workspaces/[id]/audit/page.tsx");
  assert.match(page, /requirePagePermission\("audit\.read"\)/);
  assert.match(page, /listAuditLogs/);
  assert.match(page, /ctx\.tenantId !== id/);
  assert.match(page, /method="get"/);
});

test("P5 UI: layout workspace punya sidebar permission-aware dan breadcrumb", () => {
  const layout = read("workspaces/[id]/layout.tsx");
  const sidebar = read("workspaces/[id]/workspace-sidebar.tsx");
  assert.match(layout, /requirePagePermission\(\)/);
  assert.match(layout, /ctx\.tenantId !== id/);
  assert.match(layout, /WorkspaceSidebar/);
  assert.match(sidebar, /permissions\.includes\(item\.permission\)/);
  assert.match(sidebar, /usePathname/);
  assert.match(sidebar, /settings\/holidays/);
  assert.match(sidebar, /aria-label="Breadcrumb"/);
  assert.match(sidebar, /aria-current/);
});

test("P5 UI: statistik keterlambatan memakai bar CSS tanpa dependency chart", () => {
  const page = read("workspaces/[id]/reports/late/page.tsx");
  assert.match(page, /requirePagePermission\("attendance\.read"\)/);
  assert.match(page, /getLateStats/);
  assert.match(page, /<Bars/);
  assert.doesNotMatch(page, /from "recharts"|from "chart\.js"/);
});

test("P5 UI: rekap bulanan memakai attendance.read dan expand per tanggal", () => {
  const page = read("workspaces/[id]/reports/page.tsx");
  assert.match(page, /requirePagePermission\("attendance\.read"\)/);
  assert.match(page, /ctx\.tenantId !== id/);
  assert.match(page, /getMonthlyReport/);
  assert.match(page, /<details/);
  assert.match(page, /totalWorkHours/);
  assert.match(page, /totalAbsent/);
});

test("P5 UI: dashboard memakai attendance.read dan menampilkan ringkasan", () => {
  const page = read("workspaces/[id]/dashboard/page.tsx");
  assert.match(page, /requirePagePermission\("attendance\.read"\)/);
  assert.match(page, /ctx\.tenantId !== id/);
  assert.match(page, /getTodayDashboard/);
  assert.match(page, /Dashboard hari ini/);
  assert.match(page, /Revisi pending/);
  assert.match(page, /Masih di kantor/);
});

test("P4 UI: antrian revisi memakai correction.read dan tombol review endpoint benar", () => {
  const page = read("workspaces/[id]/corrections/page.tsx");
  const queue = read("workspaces/[id]/corrections/correction-queue.tsx");
  assert.match(page, /requirePagePermission\("correction\.read"\)/);
  assert.match(page, /ctx\.tenantId !== id/);
  assert.match(page, /listWorkspaceCorrections/);
  assert.match(page, /defaultValue=\{status\}/);
  assert.match(queue, /\/api\/corrections\/\$\{selected\.correction\.id\}/);
  assert.match(queue, /"PATCH"/);
  assert.match(queue, /role="alert"/);
  assert.match(queue, /Alasan penolakan minimal \$\{MIN_REJECTION_REASON\} karakter/);
  assert.match(queue, /rejectionReason: trimmed/);
  assert.match(queue, /router\.refresh\(\)/);
});

test("P4 UI: detail revisi membandingkan waktu, bukti, audit, dan 404/403", () => {
  const page = read("workspaces/[id]/corrections/[correctionId]/page.tsx");
  assert.match(page, /requirePagePermission\("correction\.read"\)/);
  assert.match(page, /ctx\.tenantId !== id/);
  assert.match(page, /getWorkspaceCorrection/);
  assert.match(page, /notFound\(\)/);
  assert.match(page, /error instanceof HttpError && error\.status === 404/);
  assert.match(page, /listAuditLogs/);
  assert.match(page, /resourceId: correctionId/);
  assert.match(page, /originalTimestamp/);
  assert.match(page, /requestedTimestamp/);
  assert.match(page, /Bukti revisi/);
});

test("B5 UI: halaman accept memanggil endpoint dan menampilkan status", () => {
  const form = read("accept-invitation/accept-invitation-form.tsx");
  assert.match(form, /\/api\/invitations\/accept/);
  assert.match(form, /Undangan diterima/);
  assert.match(form, /role="alert"/);
});
