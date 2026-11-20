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
    <main className="page page--narrow">
      <div className="page-head">
        <div>
          <p className="eyebrow">Kotak masuk</p>
          <h1 className="page-title">Notifikasi</h1>
          <p className="page-subtitle">
            {inbox.unreadCount} notifikasi belum dibaca dari {inbox.notifications.length} terbaru.
          </p>
        </div>
      </div>
      <NotificationInbox
        notifications={inbox.notifications}
        unreadCount={inbox.unreadCount}
      />
    </main>
  );
}
