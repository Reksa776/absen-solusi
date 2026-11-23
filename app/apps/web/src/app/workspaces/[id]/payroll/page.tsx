import { redirect } from "next/navigation";
import { listPayrollRuns } from "@absensi/auth";
import { requirePagePermission } from "@/lib/page-auth";
import { PayrollGenerateForm } from "@/components/phase-c-forms";

export const dynamic = "force-dynamic";

const money = new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 });

export default async function PayrollPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { ctx } = await requirePagePermission("member.manage");
  if (!ctx || ctx.tenantId !== id) redirect("/workspaces?error=forbidden");
  const now = new Date();
  const runs = await listPayrollRuns({ ctx, workspaceId: id });
  return (
    <main className="page">
      <div className="page-head"><div><p className="eyebrow">Gaji</p><h1 className="page-title">Hitung gaji</h1><p className="page-subtitle">Payroll bulanan otomatis dari kehadiran, keterlambatan, lembur, cuti/izin, dan SP aktif.</p></div><div className="btn-row"><a className="btn btn--secondary" href={`/workspaces/${id}/payroll/settings`}>Pengaturan gaji</a><a className="btn btn--secondary" href={`/workspaces/${id}/payroll/reports`}>Laporan</a></div></div>
      <PayrollGenerateForm workspaceId={id} year={now.getUTCFullYear()} month={now.getUTCMonth() + 1} />
      <div className="table-wrap" style={{ marginTop: "1.25rem" }}>
        <div className="table-head"><div><h2 className="section-title">Riwayat payroll</h2><p className="section-note">DRAFT dapat dihitung ulang; FINALIZED terkunci.</p></div><span className="badge badge--neutral"><span className="num">{runs.length}</span> periode</span></div>
        <div className="table-scroll"><table className="data"><thead><tr><th>Periode</th><th>Status</th><th>Karyawan</th><th>Bruto</th><th>Potongan</th><th>Net</th><th>Dibuat</th></tr></thead><tbody>{runs.length === 0 ? <tr><td colSpan={7} className="empty">Belum ada payroll.</td></tr> : null}{runs.map((run) => <tr key={run.id}><td className="mono nowrap">{String(run.periodMonth).padStart(2, "0")}/{run.periodYear}</td><td><span className={run.status === "DRAFT" ? "badge badge--yellow" : run.status === "PAID" ? "badge badge--green" : "badge badge--neutral"}>{run.status}</span></td><td className="num">{run.memberCount}</td><td className="num">{money.format(run.totalGross)}</td><td className="num">{money.format(run.totalDeductions)}</td><td className="num"><strong>{money.format(run.totalNet)}</strong></td><td className="muted">{run.generatedByName}</td></tr>)}</tbody></table></div>
      </div>
    </main>
  );
}
