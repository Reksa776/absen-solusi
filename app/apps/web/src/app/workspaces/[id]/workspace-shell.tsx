"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";

import { WorkspaceBreadcrumb, WorkspaceSidebar } from "./workspace-sidebar";

/**
 * Kerangka workspace: sidebar tetap di desktop, drawer ber-overlay di layar
 * kecil. Menutup drawer otomatis setiap kali rute berubah.
 */
export function WorkspaceShell({
  workspaceId,
  workspaceName,
  logoUrl,
  permissions,
  userEmail,
  unreadCount,
  wfhPending,
  todayLabel,
  children,
}: {
  workspaceId: string;
  workspaceName: string;
  logoUrl?: string | null;
  permissions: readonly string[];
  userEmail: string;
  unreadCount: number;
  wfhPending: number;
  todayLabel: string;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!open) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <div className="app-shell">
      <WorkspaceSidebar
        workspaceId={workspaceId}
        workspaceName={workspaceName}
        logoUrl={logoUrl}
        permissions={permissions}
        userEmail={userEmail}
        wfhPending={wfhPending}
        open={open}
        onClose={() => setOpen(false)}
      />
      {open ? (
        <button
          type="button"
          className="sidebar-backdrop"
          aria-label="Tutup menu navigasi"
          onClick={() => setOpen(false)}
        />
      ) : null}
      <div className="shell-main">
        <header className="topbar">
          <div className="topbar-start">
            <button
              type="button"
              className="menu-toggle"
              aria-label="Buka menu navigasi"
              aria-expanded={open}
              aria-controls="workspace-sidebar"
              onClick={() => setOpen(true)}
            >
              <svg
                aria-hidden="true"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
              >
                <path d="M4 7h16M4 12h16M4 17h16" />
              </svg>
            </button>
            <WorkspaceBreadcrumb workspaceId={workspaceId} />
          </div>
          <div className="topbar-meta">
            <span className="date-pill">
              <strong>Hari ini</strong>
              {todayLabel}
            </span>
            <Link
              href={`/workspaces/${workspaceId}/notifications`}
              aria-label={`Notifikasi, ${unreadCount} belum dibaca`}
              className="icon-link"
            >
              <svg
                aria-hidden="true"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M18 8a6 6 0 1 0-12 0c0 7-3 8-3 8h18s-3-1-3-8" />
                <path d="M13.7 20a2 2 0 0 1-3.4 0" />
              </svg>
              {unreadCount > 0 ? (
                <span className="badge-count" aria-hidden="true">
                  {unreadCount}
                </span>
              ) : (
                <span className="muted" style={{ fontWeight: 500 }}>
                  Kotak masuk
                </span>
              )}
            </Link>
          </div>
        </header>
        {children}
      </div>
    </div>
  );
}
