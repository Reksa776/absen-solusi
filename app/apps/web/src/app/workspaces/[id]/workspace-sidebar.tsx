"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV_ITEMS = [
  { slug: "dashboard", label: "Dashboard", permission: "attendance.read" },
  { slug: "members", label: "Members", permission: "member.read" },
  { slug: "corrections", label: "Corrections", permission: "correction.read" },
  { slug: "overtime", label: "Lembur", permission: "correction.review" },
  { slug: "wfh", label: "WFH", permission: "correction.review" },
  { slug: "reports", label: "Reports", permission: "attendance.read" },
  { slug: "reports/payroll", label: "Payroll", permission: "attendance.read" },
  { slug: "notifications", label: "Notifikasi", permission: "workspace.read" },
  { slug: "audit", label: "Audit", permission: "audit.read" },
  { slug: "settings/office", label: "Kantor", permission: "office.manage" },
  { slug: "settings/shifts", label: "Shift kerja", permission: "office.manage" },
  { slug: "settings/holidays", label: "Hari libur", permission: "workspace.manage" },
] as const;

const BREADCRUMBS: Record<string, string> = {
  dashboard: "Dashboard",
  members: "Members",
  corrections: "Corrections",
  bulk: "Koreksi massal",
  overtime: "Lembur",
  wfh: "WFH",
  reports: "Reports",
  payroll: "Payroll",
  notifications: "Notifikasi",
  late: "Statistik keterlambatan",
  audit: "Audit",
  settings: "Settings",
  office: "Kantor",
  shifts: "Shift kerja",
  holidays: "Hari libur",
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

export function WorkspaceSidebar({
  workspaceId,
  permissions,
  userEmail,
}: {
  workspaceId: string;
  permissions: readonly string[];
  userEmail: string;
}) {
  const pathname = usePathname();
  const base = `/workspaces/${workspaceId}`;
  const allowed = NAV_ITEMS.filter((item) => permissions.includes(item.permission));
  const crumbs = labelsFor(pathname);

  return (
    <aside
      style={{
        width: "15rem",
        flexShrink: 0,
        borderRight: "1px solid #ddd",
        background: "#fff",
        padding: "1.25rem 1rem",
        fontFamily: "system-ui, sans-serif",
        fontSize: "0.9rem",
      }}
    >
      <div style={{ fontWeight: 600, marginBottom: "0.25rem" }}>Absensi Admin</div>
      <div style={{ color: "#555", fontSize: "0.75rem", marginBottom: "1rem" }}>
        {userEmail}
      </div>

      <nav aria-label="Navigasi workspace">
        <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: "0.25rem" }}>
          {allowed.map((item) => {
            const href = `${base}/${item.slug}`;
            const active = pathname === href || pathname.startsWith(`${href}/`);
            return (
              <li key={item.slug}>
                <Link
                  href={href}
                  aria-current={active ? "page" : undefined}
                  style={{
                    display: "block",
                    padding: "0.4rem 0.5rem",
                    borderRadius: "0.35rem",
                    textDecoration: "none",
                    color: active ? "#fff" : "#111",
                    background: active ? "#00695c" : "transparent",
                  }}
                >
                  {item.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      <div style={{ marginTop: "1.5rem", display: "grid", gap: "0.5rem" }}>
        <Link href="/settings/security" style={{ color: "#00695c" }}>
          Keamanan 2FA
        </Link>
        <Link href="/workspaces" style={{ color: "#00695c" }}>
          ← Ganti workspace
        </Link>
      </div>

      <nav aria-label="Breadcrumb" style={{ marginTop: "1rem", color: "#555" }}>
        <Link href={base} style={{ color: "#555" }}>
          Workspace
        </Link>
        {crumbs.map((crumb, index) => (
          <span key={`${crumb.href}-${index}`}>
            {" / "}
            {index === crumbs.length - 1 ? (
              <span aria-current="page">{crumb.label}</span>
            ) : (
              <Link href={`${base}${crumb.href}`} style={{ color: "#555" }}>
                {crumb.label}
              </Link>
            )}
          </span>
        ))}
      </nav>
    </aside>
  );
}
