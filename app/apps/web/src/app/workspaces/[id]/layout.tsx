import Link from "next/link";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { getCompanyProfile, listMyNotifications } from "@absensi/auth";

import { requirePagePermission } from "@/lib/page-auth";
import { WorkspaceBreadcrumb, WorkspaceSidebar } from "./workspace-sidebar";

export const dynamic = "force-dynamic";

const DATE_FORMAT = new Intl.DateTimeFormat("id-ID", {
  weekday: "long",
  day: "numeric",
  month: "short",
  year: "numeric",
});

export default async function WorkspaceLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { ctx, user, workspaces } = await requirePagePermission();
  if (!ctx || ctx.tenantId !== id) redirect("/workspaces?error=forbidden");
  const [inbox, company] = await Promise.all([
    listMyNotifications({ ctx, limit: 1 }),
    getCompanyProfile({ ctx, workspaceId: id }),
  ]);
  const workspaceName =
    workspaces.find((workspace) => workspace.id === id)?.name ?? "Workspace";

  return (
    <div className="app-shell">
      <WorkspaceSidebar
        workspaceId={id}
        workspaceName={workspaceName}
        logoUrl={company.logoUrl}
        permissions={ctx.permissions}
        userEmail={user.email}
      />
      <div className="shell-main">
        <header className="topbar">
          <WorkspaceBreadcrumb workspaceId={id} />
          <div className="topbar-meta">
            <span className="date-pill">
              <strong>Hari ini</strong>
              {DATE_FORMAT.format(new Date())}
            </span>
            <Link
              href={`/workspaces/${id}/notifications`}
              aria-label={`Notifikasi, ${inbox.unreadCount} belum dibaca`}
              className="icon-link"
            >
              <span aria-hidden="true">🔔</span>
              {inbox.unreadCount > 0 ? (
                <span className="badge-count" aria-hidden="true">
                  {inbox.unreadCount}
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
