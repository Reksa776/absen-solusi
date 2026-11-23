"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV_GROUPS = [
  {
    label: "Ringkasan",
    items: [
      { slug: "dashboard", label: "Dashboard", permission: "attendance.read" },
      { slug: "broadcasts", label: "Broadcast", permission: "member.read" },
      { slug: "notifications", label: "Notifikasi", permission: "workspace.read" },
    ],
  },
  {
    label: "Kelola karyawan",
    items: [
      { slug: "members", label: "Karyawan", permission: "member.read" },
      { slug: "warning-letters", label: "Kirim surat peringatan", permission: "member.read" },
      { slug: "settings/organization", label: "Divisi & jabatan", permission: "member.read" },
    ],
  },
  {
    label: "Kehadiran",
    items: [
      { slug: "corrections", label: "Koreksi presensi", permission: "correction.read" },
      { slug: "overtime", label: "Lembur", permission: "correction.review" },
      { slug: "wfh", label: "WFH", permission: "correction.review" },
      { slug: "permits", label: "Izin kerja", permission: "correction.review" },
      { slug: "permits/review", label: "Review izin kerja", permission: "correction.review" },
      { slug: "leave", label: "Permohonan cuti", permission: "correction.review" },
      { slug: "leave/report", label: "Laporan cuti", permission: "correction.review" },
      { slug: "attendance-review", label: "Review luar kota", permission: "correction.review" },
      { slug: "devices", label: "Persetujuan perangkat", permission: "member.read" },
      { slug: "profile-photos", label: "Persetujuan foto profil", permission: "correction.review" },
      { slug: "reports", label: "Laporan", permission: "attendance.read" },
      { slug: "reports/payroll", label: "Payroll", permission: "attendance.read" },
    ],
  },
  {
    label: "Pengaturan",
    items: [
      { slug: "settings/approvals", label: "Alur persetujuan", permission: "member.read" },
      { slug: "leave/settings", label: "Pengaturan cuti", permission: "correction.review" },
      { slug: "settings/mobile", label: "Pengaturan mobile", permission: "member.read" },
      { slug: "settings/office", label: "Kantor", permission: "office.manage" },
      { slug: "settings/shifts", label: "Shift kerja", permission: "office.manage" },
      { slug: "settings/holidays", label: "Hari libur", permission: "workspace.manage" },
      { slug: "settings/app-release", label: "Rilis aplikasi", permission: "workspace.manage" },
      { slug: "audit", label: "Audit", permission: "audit.read" },
    ],
  },
] as const;

const BREADCRUMBS: Record<string, string> = {
  dashboard: "Dashboard",
  members: "Members",
  corrections: "Corrections",
  bulk: "Koreksi massal",
  overtime: "Lembur",
  wfh: "WFH",
  permits: "Izin kerja",
  review: "Review izin kerja",
  leave: "Permohonan cuti",
  "warning-letters": "Kirim surat peringatan",
  broadcasts: "Broadcast",
  reports: "Reports",
  payroll: "Payroll",
  notifications: "Notifikasi",
  late: "Statistik keterlambatan",
  audit: "Audit",
  settings: "Settings",
  organization: "Divisi & jabatan",
  office: "Kantor",
  shifts: "Shift kerja",
  holidays: "Hari libur",
  "app-release": "Rilis aplikasi",
  devices: "Persetujuan perangkat",
  "profile-photos": "Persetujuan foto profil",
  "attendance-review": "Review luar kota",
  approvals: "Alur persetujuan",
  mobile: "Pengaturan mobile",
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

/** Breadcrumb top bar: halaman aktif dengan tautan antar level. */
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
  const groups = NAV_GROUPS.map((group) => ({
    ...group,
    items: group.items.filter((item) => permissions.includes(item.permission)),
  })).filter((group) => group.items.length > 0);

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
        {groups.map((group) => (
          <div key={group.label}>
            <div className="nav-group-label">{group.label}</div>
            <ul className="nav-list">
              {group.items.map((item) => {
                const href = `${base}/${item.slug}`;
                const active = pathname === href || pathname.startsWith(`${href}/`);
                return (
                  <li key={item.slug}>
                    <Link
                      href={href}
                      aria-current={active ? "page" : undefined}
                      className="nav-link"
                    >
                      <span>{item.label}</span>
                      {active ? <span className="nav-dot" aria-hidden="true" /> : null}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
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
