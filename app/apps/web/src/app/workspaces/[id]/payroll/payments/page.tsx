import { redirect } from "next/navigation";
import { listPayrollRuns } from "@absensi/auth";
import { requirePagePermission } from "@/lib/page-auth";
import { PayrollRunActions } from "@/components/phase-c-forms";

export const dynamic = "force-dynamic";

const money = new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 });

export default async function PayrollPaymentsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { ctx } = await requirePagePermission("member.manage");
  if (!ctx || ctx.tenantId !== id) redirect("/workspaces?error=forbidden");
  const runs = await listPayrollRuns({ ctx, workspaceId: id });
  return (
    <main className="page">
      <div className="page-head"><div><p className="eyebrow">Gaji</p><h1 className="page-title">Pembayaran</h1><p className="page-subtitle">Finalisasi payroll lalu catat referensi transfer. Karyawan menerima notifikasi in-app.</p></div><a className="btn btn--secondary" href={`/workspaces/${id}/payroll`}>Hitung gaji</a></div>
      <div className="table-wrap"><div className="table-head"><div><h2 className="section-title">Antrean pembayaran</h2><p className="section-note">Hanya payroll FINALIZED yang dapat dibayar.</p></div></div><div className="table-scroll"><table className="data"><thead><tr><th>Periode</th><th>Status</th><th>Karyawan</th><th>Net</th><th>Referensi</th><th>Aksi</th></tr></thead><tbody>{runs.length === 0 ? <tr><td colSpan={6} className="empty">Belum ada payroll.</td></tr> : null}{runs.map((run) => <tr key={run.id}><td className="mono">{String(run.periodMonth).padStart(2, "0")}/{run.periodYear}</td><td><span className={run.status === "PAID" ? "badge badge--green" : run.status === "FINALIZED" ? "badge badge--yellow" : "badge badge--neutral"}>{run.status}</span></td><td className="num">{run.memberCount}</td><td className="num">{money.format(run.totalNet)}</td><td className="mono">{run.paymentReference ?? "—"}</td><td><PayrollRunActions workspaceId={id} runId={run.id} status={run.status} /></td></tr>)}</tbody></table></div></div>
    </main>
  );
}
