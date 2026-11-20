import Link from "next/link";
import { redirect } from "next/navigation";

import { listMyNotifications } from "@absensi/auth";

import { requirePagePermission } from "@/lib/page-auth";
import { NotificationInbox } from "./notification-inbox";

export const dynamic = "force-dynamic";

export default async function NotificationsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { ctx } = await requirePagePermission("workspace.read");
  if (!ctx || ctx.tenantId !== id) redirect("/workspaces?error=forbidden");
  const inbox = await listMyNotifications({ ctx, limit: 100 });

  return (
    <main
      style={{
        fontFamily: "system-ui, sans-serif",
        maxWidth: "56rem",
        margin: "0 auto",
        padding: "3rem 1.5rem",
        lineHeight: 1.6,
      }}
    >
      <p>
        <Link href={`/workspaces/${id}/dashboard`}>← Dashboard</Link>
      </p>
      <h1 style={{ fontSize: "1.5rem" }}>Notifikasi</h1>
      <p style={{ color: "#555" }}>
        {inbox.unreadCount} notifikasi belum dibaca dari {inbox.notifications.length} terbaru.
      </p>
      <NotificationInbox
        notifications={inbox.notifications}
        unreadCount={inbox.unreadCount}
      />
    </main>
  );
}
