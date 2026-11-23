import { redirect } from "next/navigation";
import { getClientVisitSettings } from "@absensi/auth";
import { requirePagePermission } from "@/lib/page-auth";
import { VisitSettingsForm } from "@/components/phase-c-forms";

export const dynamic = "force-dynamic";

export default async function ClientVisitSettingsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { ctx } = await requirePagePermission("attendance.read");
  if (!ctx || ctx.tenantId !== id) redirect("/workspaces?error=forbidden");
  const settings = await getClientVisitSettings({ ctx, workspaceId: id });
  return (
    <main className="page page--narrow">
      <div className="page-head"><div><p className="eyebrow">Kunjungan client</p><h1 className="page-title">Pengaturan kunjungan</h1><p className="page-subtitle">Aturan radius, foto bukti, dan check-out kunjungan lapangan.</p></div></div>
      <VisitSettingsForm workspaceId={id} initial={settings} canManage={ctx.permissions.includes("member.manage")} />
    </main>
  );
}
