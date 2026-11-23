"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

type NavItem = { slug: string; label: string; permission: string };
type NavGroup = { label: string; items: NavItem[] };
type NavEntry = NavGroup | { label: string; slug: string; permission: string; standalone: true };

const NAV_ENTRIES: readonly NavEntry[] = [
  {
    label: "Kelola Karyawan",
    items: [
      { slug: "divisions", label: "Divisi", permission: "member.read" },
      { slug: "positions", label: "Jabatan", permission: "member.read" },
      { slug: "settings/office", label: "Lokasi Kehadiran", permission: "office.manage" },
      { slug: "members", label: "Data Karyawan", permission: "member.read" },
      { slug: "work-schedules", label: "Jadwal Hari Kerja", permission: "member.read" },
      { slug: "settings/shifts", label: "Jadwal Shift", permission: "office.manage" },
      { slug: "warning-letters", label: "Kirim Surat Peringatan", permission: "member.read" },
    ],
  },
  {
    label: "Pola Kerja",
    items: [{ slug: "work-patterns", label: "Hari Kerja", permission: "member.read" }],
  },
  {
    label: "Kehadiran",
    items: [
      { slug: "attendance", label: "Kehadiran Harian", permission: "attendance.read" },
      { slug: "attendance/summary", label: "Ringkasan Kehadiran", permission: "attendance.read" },
      {
        slug: "attendance-review",
        label: "Review Kehadiran Luar Kota",
        permission: "correction.review",
      },
      { slug: "corrections", label: "Revisi Kehadiran", permission: "correction.read" },
      {
        slug: "attendance/approvals",
        label: "Persetujuan Presensi",
        permission: "correction.review",
      },
      { slug: "devices", label: "Persetujuan Perangkat", permission: "member.read" },
      {
        slug: "profile-photos",
        label: "Persetujuan Foto Profil",
        permission: "correction.review",
      },
      {
        slug: "attendance/notes",
        label: "Rekap Catatan Presensi",
        permission: "attendance.read",
      },
      {
        slug: "attendance/settings",
        label: "Pengaturan Kehadiran",
        permission: "attendance.read",
      },
    ],
  },
  {
    label: "Lembur",
    items: [
      { slug: "overtime", label: "Review", permission: "correction.review" },
      { slug: "overtime/schedule", label: "Jadwal", permission: "correction.review" },
      { slug: "overtime/settings", label: "Pengaturan", permission: "correction.review" },
    ],
  },
  {
    label: "Izin",
    items: [
      { slug: "permits", label: "Izin Kerja", permission: "correction.review" },
      { slug: "permits/review", label: "Review Izin Kerja", permission: "correction.review" },
    ],
  },
  {
    label: "Cuti",
    items: [
      { slug: "leave", label: "Permohonan", permission: "correction.review" },
      { slug: "leave/report", label: "Laporan", permission: "correction.review" },
      { slug: "leave/settings", label: "Pengaturan", permission: "correction.review" },
    ],
  },
  {
    label: "Kunjungan Client",
    items: [
      { slug: "client-visits/logs", label: "Kunjungan", permission: "attendance.read" },
      { slug: "client-visits/map", label: "Virtualisasi Kunjungan", permission: "attendance.read" },
      { slug: "client-visits/summary", label: "Ringkasan Kunjungan", permission: "attendance.read" },
      { slug: "client-visits/insights", label: "AI Insight", permission: "attendance.read" },
      { slug: "clients", label: "Client", permission: "attendance.read" },
      { slug: "client-visits", label: "Jadwal Kunjungan", permission: "attendance.read" },
      { slug: "client-visits/settings", label: "Pengaturan", permission: "attendance.read" },
    ],
  },
  {
    label: "Pekerjaan",
    items: [{ slug: "work-projections", label: "Proyeksi", permission: "attendance.read" }],
  },
  { label: "Broadcast", slug: "broadcasts", permission: "member.read", standalone: true },
  {
    label: "Gaji",
    items: [
      { slug: "payroll", label: "Hitung", permission: "member.manage" },
      { slug: "payroll/payments", label: "Pembayaran", permission: "member.manage" },
      { slug: "payroll/reports", label: "Laporan", permission: "member.manage" },
      { slug: "payroll/settings", label: "Pengaturan", permission: "member.manage" },
    ],
  },
  {
    label: "Pengaturan",
    items: [
      { slug: "settings/company", label: "Perusahaan", permission: "workspace.read" },
      { slug: "settings/mobile", label: "Pengaturan Mobile", permission: "member.read" },
      { slug: "settings/approvals", label: "Alur Persetujuan", permission: "member.read" },
      { slug: "settings/holidays", label: "Kalender Libur", permission: "workspace.manage" },
      { slug: "settings/admin-accounts", label: "Akun Admin", permission: "member.read" },
    ],
  },
  { label: "Panduan", slug: "guide", permission: "workspace.read", standalone: true },
];

const BREADCRUMBS: Record<string, string> = {
  dashboard: "Dashboard",
  members: "Data karyawan",
  corrections: "Revisi kehadiran",
  bulk: "Koreksi massal",
  overtime: "Lembur",
  schedule: "Jadwal lembur",
  wfh: "WFH",
  permits: "Izin kerja",
  review: "Review",
  leave: "Cuti",
  "warning-letters": "Surat peringatan",
  broadcasts: "Broadcast",
  reports: "Laporan",
  payroll: "Gaji",
  notifications: "Notifikasi",
  late: "Statistik keterlambatan",
  audit: "Audit",
  settings: "Pengaturan",
  organization: "Divisi & jabatan",
  divisions: "Divisi",
  positions: "Jabatan",
  office: "Lokasi kehadiran",
  shifts: "Jadwal shift",
  holidays: "Kalender libur",
  "app-release": "Rilis aplikasi",
  devices: "Persetujuan perangkat",
  "profile-photos": "Persetujuan foto profil",
  "attendance-review": "Review kehadiran luar kota",
  attendance: "Kehadiran",
  approvals: "Persetujuan presensi",
  notes: "Rekap catatan presensi",
  summary: "Ringkasan kehadiran",
  mobile: "Pengaturan mobile",
  clients: "Client",
  "client-visits": "Kunjungan client",
  logs: "Kunjungan",
  map: "Virtualisasi kunjungan",
  insights: "AI insight",
  "work-projections": "Proyeksi pekerjaan",
  "work-patterns": "Hari kerja",
  "work-schedules": "Jadwal hari kerja",
  company: "Perusahaan",
  "admin-accounts": "Akun admin",
  guide: "Panduan",
  payments: "Pembayaran",
  slips: "Slip gaji",
};

function labelsFor(pathname: string): Array<{ label: string; href: string }> {
  const marker = "/corrections/";
  const parts = pathname.split("/").filter(Boolean);
  const workspaceIndex = parts.indexOf("workspaces");
  const tail = workspaceIndex >= 0 ? parts.slice(workspaceIndex + 2) : [];
  const crumbs: Array<{ label: string; href: string }> = [];
  let href = "";
  for (const part of tail) {
    href += `/${part}`;
    crumbs.push({
      label: BREADCRUMBS[part] ?? (pathname.includes(marker) ? "Detail revisi" : part),
      href,
    });
  }
  return crumbs;
}

function visibleItems(entry: NavGroup, permissions: readonly string[]) {
  return entry.items.filter((item) => permissions.includes(item.permission));
}

export function WorkspaceBreadcrumb({ workspaceId }: { workspaceId: string }) {
  const pathname = usePathname();
  const base = `/workspaces/${workspaceId}`;
  const crumbs = labelsFor(pathname);

  return (
    <nav aria-label="Breadcrumb" className="breadcrumb">
      <Link href={base}>Workspace</Link>
      {crumbs.map((crumb, index) => (
        <span key={`${crumb.href}-${index}`} style={{ display: "contents" }}>
          <span className="sep" aria-hidden="true">
            /
          </span>
          {index === crumbs.length - 1 ? (
            <span aria-current="page">{crumb.label}</span>
          ) : (
            <Link href={`${base}${crumb.href}`}>{crumb.label}</Link>
          )}
        </span>
      ))}
    </nav>
  );
}

export function WorkspaceSidebar({
  workspaceId,
  workspaceName,
  permissions,
  userEmail,
}: {
  workspaceId: string;
  workspaceName: string;
  permissions: readonly string[];
  userEmail: string;
}) {
  const pathname = usePathname();
  const base = `/workspaces/${workspaceId}`;
  const entries = NAV_ENTRIES.map((entry): NavEntry | null => {
    if ("standalone" in entry) {
      return permissions.includes(entry.permission) ? entry : null;
    }
    const items = visibleItems(entry, permissions);
    return items.length > 0 ? { ...entry, items } : null;
  }).filter((entry): entry is NavEntry => entry !== null);

  const allHrefs: string[] = [];
  for (const entry of entries) {
    if ("standalone" in entry) allHrefs.push(`${base}/${entry.slug}`);
    else for (const item of entry.items) allHrefs.push(`${base}/${item.slug}`);
  }
  const activeHref = allHrefs
    .filter((href) => pathname === href || pathname.startsWith(`${href}/`))
    .sort((left, right) => right.length - left.length)[0];
  const activeGroup = entries.find(
    (entry): entry is NavGroup =>
      "items" in entry && entry.items.some((item) => `${base}/${item.slug}` === activeHref),
  );

  const [openGroups, setOpenGroups] = useState<Set<string>>(
    () => new Set(activeGroup ? [activeGroup.label] : []),
  );
  useEffect(() => {
    if (!activeGroup) return;
    setOpenGroups((current) => {
      if (current.has(activeGroup.label)) return current;
      const next = new Set(current);
      next.add(activeGroup.label);
      return next;
    });
  }, [activeGroup, pathname]);

  function toggle(label: string) {
    setOpenGroups((current) => {
      const next = new Set(current);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      return next;
    });
  }

  return (
    <aside className="sidebar">
      <div className="brand">
        <span className="brand-mark" aria-hidden="true">
          A
        </span>
        <div style={{ minWidth: 0 }}>
          <div className="brand-title">Absensi Admin</div>
          <div className="brand-sub" title={workspaceName}>
            {workspaceName}
          </div>
        </div>
      </div>

      <nav aria-label="Navigasi workspace">
        {entries.map((entry) => {
          if ("standalone" in entry) {
            const href = `${base}/${entry.slug}`;
            const active = activeHref === href;
            return (
              <div key={entry.label} className="nav-standalone">
                <Link
                  href={href}
                  aria-current={active ? "page" : undefined}
                  className="nav-link"
                >
                  <span>{entry.label}</span>
                  {active ? <span className="nav-dot" aria-hidden="true" /> : null}
                </Link>
              </div>
            );
          }
          const open = openGroups.has(entry.label);
          const active = entry.items.some((item) => `${base}/${item.slug}` === activeHref);
          const panelId = `nav-panel-${entry.label.replaceAll(" ", "-").toLowerCase()}`;
          return (
            <div key={entry.label} className="nav-group">
              <button
                type="button"
                className="nav-group-toggle"
                aria-expanded={open}
                aria-controls={panelId}
                onClick={() => toggle(entry.label)}
              >
                <span>{entry.label}</span>
                <span style={{ display: "inline-flex", alignItems: "center", gap: "0.4rem" }}>
                  <span className="nav-group-count">{entry.items.length}</span>
                  <span className="nav-chevron" aria-hidden="true" />
                </span>
              </button>
              <div
                className={`nav-group-panel${open ? " nav-group-panel--open" : ""}`}
                id={panelId}
                aria-hidden={!open}
              >
                <div>
                  <ul className="nav-list">
                    {entry.items.map((item) => {
                      const href = `${base}/${item.slug}`;
                      return (
                        <li key={item.slug}>
                          <Link
                            href={href}
                            aria-current={activeHref === href ? "page" : undefined}
                            className="nav-link"
                          >
                            <span>{item.label}</span>
                            {activeHref === href ? (
                              <span className="nav-dot" aria-hidden="true" />
                            ) : null}
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              </div>
              {active ? <span className="sr-only">Grup aktif</span> : null}
            </div>
          );
        })}
      </nav>

      <div className="sidebar-footer">
        <div className="sidebar-user">
          <span>Masuk sebagai</span>
          <strong>{userEmail}</strong>
        </div>
        <Link href="/settings/security" className="nav-link nav-link--sub">
          Keamanan 2FA
        </Link>
        <Link href="/workspaces" className="nav-link nav-link--sub">
          Ganti workspace
        </Link>
      </div>
    </aside>
  );
}
