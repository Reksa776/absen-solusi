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
  assert.match(sidebar, /slug: "divisions"/);
  assert.match(sidebar, /slug: "positions"/);
  assert.match(sidebar, /slug: "work-schedules"/);
  assert.match(sidebar, /label: "Kelola Karyawan"/);
  assert.doesNotMatch(sidebar, /settings\/organization/);
});

test("sidebar operasional: seluruh sub-nav standar Kerjoo punya halaman nyata", () => {
  const sidebar = read("workspaces/[id]/workspace-sidebar.tsx");
  for (const label of [
    "Divisi",
    "Jabatan",
    "Lokasi Kehadiran",
    "Data Karyawan",
    "Jadwal Hari Kerja",
    "Kirim Surat Peringatan",
    "Hari Kerja",
    "Kehadiran Harian",
    "Ringkasan Kehadiran",
    "Review Kehadiran Luar Kota",
    "Revisi Kehadiran",
    "Persetujuan Presensi",
    "Persetujuan Perangkat",
    "Persetujuan Foto Profil",
    "Rekap Catatan Presensi",
    "Pengaturan Kehadiran",
    "Jadwal",
    "Permohonan",
    "Laporan",
    "Kunjungan",
    "Virtualisasi Kunjungan",
    "Ringkasan Kunjungan",
    "AI Insight",
    "Client",
    "Jadwal Kunjungan",
    "Proyeksi",
    "Broadcast",
    "Hitung",
    "Pembayaran",
    "Perusahaan",
    "Pengaturan Mobile",
    "Alur Persetujuan",
    "Kalender Libur",
    "Akun Admin",
    "Panduan",
  ]) {
    assert.match(sidebar, new RegExp(`label: "${label}"`));
  }
  assert.doesNotMatch(sidebar, /Jadwal Shift/);
  assert.doesNotMatch(sidebar, /settings\/shifts/);
  for (const page of [
    "workspaces/[id]/shifts/page.tsx",
    "workspaces/[id]/settings/shifts/page.tsx",
  ]) {
    const redirectPage = read(page);
    assert.match(redirectPage, /redirect\(`\/workspaces\/\$\{id\}\/work-schedules`\)/);
  }
  for (const page of [
    "workspaces/[id]/divisions/page.tsx",
    "workspaces/[id]/positions/page.tsx",
    "workspaces/[id]/work-patterns/page.tsx",
    "workspaces/[id]/work-schedules/page.tsx",
    "workspaces/[id]/attendance/page.tsx",
    "workspaces/[id]/attendance/summary/page.tsx",
    "workspaces/[id]/attendance/approvals/page.tsx",
    "workspaces/[id]/attendance/notes/page.tsx",
    "workspaces/[id]/attendance/settings/page.tsx",
    "workspaces/[id]/overtime/schedule/page.tsx",
    "workspaces/[id]/overtime/settings/page.tsx",
    "workspaces/[id]/client-visits/insights/page.tsx",
  ]) {
    assert.ok(read(page).length > 500, `${page} harus berupa halaman nyata`);
  }
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

test("pola kerja: form tujuh hari memakai Minggu=0 dan toggle kerja/libur", () => {
  const manager = readFileSync(
    new URL("../src/components/work-pattern-manager.tsx", import.meta.url),
    "utf8",
  );
  assert.match(manager, /\{ dayOfWeek: 6, dayName: "Sabtu" \}/);
  assert.match(manager, /\{ dayOfWeek: 0, dayName: "Minggu" \}/);
  assert.match(manager, /pattern-toggle/);
  assert.match(manager, /Toleransi telat/);
  assert.match(manager, /Aktifkan Sabtu/);
});
