import Link from "next/link";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { listMyNotifications } from "@absensi/auth";

import { requirePagePermission } from "@/lib/page-auth";
import { WorkspaceSidebar } from "./workspace-sidebar";

export const dynamic = "force-dynamic";

export default async function WorkspaceLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { ctx, user } = await requirePagePermission();
  if (!ctx || ctx.tenantId !== id) redirect("/workspaces?error=forbidden");
  const inbox = await listMyNotifications({ ctx, limit: 1 });

  return (
    <div style={{ display: "flex", minHeight: "100vh", background: "#fafafa" }}>
      <WorkspaceSidebar
        workspaceId={id}
        permissions={ctx.permissions}
        userEmail={user.email}
      />
      <div style={{ flex: 1, minWidth: 0 }}>
        <header
          style={{
            display: "flex",
            justifyContent: "flex-end",
            alignItems: "center",
            padding: "0.65rem 1.5rem",
            borderBottom: "1px solid #ddd",
            background: "#fff",
            fontFamily: "system-ui, sans-serif",
          }}
        >
          <Link
            href={`/workspaces/${id}/notifications`}
            aria-label={`Notifikasi, ${inbox.unreadCount} belum dibaca`}
            style={{ color: "#111", textDecoration: "none", position: "relative", fontSize: "1.25rem" }}
          >
            🔔
            {inbox.unreadCount > 0 ? (
              <span
                aria-hidden="true"
                style={{
                  marginLeft: "0.35rem",
                  fontSize: "0.75rem",
                  background: "#b00020",
                  color: "#fff",
                  borderRadius: "999px",
                  padding: "0.1rem 0.4rem",
                  verticalAlign: "middle",
                }}
              >
                {inbox.unreadCount}
              </span>
            ) : null}
          </Link>
        </header>
        {children}
      </div>
    </div>
  );
}
