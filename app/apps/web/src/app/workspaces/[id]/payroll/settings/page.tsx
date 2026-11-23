import { redirect } from "next/navigation";
import { getPayrollSettings, listMemberCompensations } from "@absensi/auth";
import { requirePagePermission } from "@/lib/page-auth";
import { CompensationManager, PayrollSettingsForm } from "@/components/phase-c-forms";

export const dynamic = "force-dynamic";

export default async function PayrollSettingsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { ctx } = await requirePagePermission("member.manage");
  if (!ctx || ctx.tenantId !== id) redirect("/workspaces?error=forbidden");
  const [settings, compensations] = await Promise.all([
    getPayrollSettings({ ctx, workspaceId: id }),
    listMemberCompensations({ ctx, workspaceId: id }),
  ]);
  return (
    <main className="page">
      <div className="page-head"><div><p className="eyebrow">Gaji</p><h1 className="page-title">Pengaturan gaji</h1><p className="page-subtitle">Komponen default dan kompensasi spesifik per karyawan.</p></div><a className="btn btn--secondary" href={`/workspaces/${id}/payroll`}>Kembali ke hitung gaji</a></div>
      <PayrollSettingsForm workspaceId={id} initial={settings} />
      <div style={{ marginTop: "1.25rem" }}><CompensationManager workspaceId={id} rows={compensations} /></div>
    </main>
  );
}
