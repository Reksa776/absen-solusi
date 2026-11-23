import { redirect } from "next/navigation";

import { getMobileSettings } from "@absensi/auth";

import { requirePagePermission } from "@/lib/page-auth";
import { MobileSettingsForm } from "./mobile-settings-form";

export const dynamic = "force-dynamic";

export default async function MobileSettingsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { ctx } = await requirePagePermission("member.read");
  if (!ctx || ctx.tenantId !== id) redirect("/workspaces?error=forbidden");
  const settings = await getMobileSettings({ ctx, workspaceId: id });

  return (
    <main className="page page--narrow">
      <div className="page-head">
        <div>
          <p className="eyebrow">Pengaturan mobile</p>
          <h1 className="page-title">Keamanan perangkat</h1>
          <p className="page-subtitle">
            Atur kebijakan pengikatan perangkat untuk check-in dan check-out mobile.
          </p>
        </div>
        <span className="badge badge--neutral">
          {settings.requireDeviceApproval ? "Persetujuan wajib" : "Bebas perangkat"}
        </span>
      </div>
      <MobileSettingsForm
        workspaceId={id}
        initialRequireDeviceApproval={settings.requireDeviceApproval}
        initialAutoApproveFirstDevice={settings.autoApproveFirstDevice}
        canManage={ctx.permissions.includes("member.manage")}
      />
    </main>
  );
}
