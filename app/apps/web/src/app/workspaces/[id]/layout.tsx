import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import {
  getCompanyProfile,
  listMyNotifications,
  listWorkspaceWfh,
} from "@absensi/auth";

import { requirePagePermission } from "@/lib/page-auth";
import { WorkspaceShell } from "./workspace-shell";

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
  const canReviewWfh = ctx.permissions.includes("correction.review");
  const [inbox, company, wfhPending] = await Promise.all([
    listMyNotifications({ ctx, limit: 1 }),
    getCompanyProfile({ ctx, workspaceId: id }),
    canReviewWfh
      ? listWorkspaceWfh({ ctx, workspaceId: id, status: "PENDING" })
      : Promise.resolve([]),
  ]);
  const workspaceName =
    workspaces.find((workspace) => workspace.id === id)?.name ?? "Workspace";

  return (
    <WorkspaceShell
      workspaceId={id}
      workspaceName={workspaceName}
      logoUrl={company.logoUrl}
      permissions={ctx.permissions}
      userEmail={user.email}
      unreadCount={inbox.unreadCount}
      wfhPending={wfhPending.length}
      todayLabel={DATE_FORMAT.format(new Date())}
    >
      {children}
    </WorkspaceShell>
  );
}
