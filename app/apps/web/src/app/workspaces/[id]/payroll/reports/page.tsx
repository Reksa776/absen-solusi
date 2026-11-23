import { redirect } from "next/navigation";
import { getPayrollRun, listPayrollRuns } from "@absensi/auth";
import { requirePagePermission } from "@/lib/page-auth";

export const dynamic = "force-dynamic";

const money = new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 });

export default async function PayrollReportsPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ runId?: string }> }) {
  const { id } = await params;
  const query = await searchParams;
  const { ctx } = await requirePagePermission("member.manage");
  if (!ctx || ctx.tenantId !== id) redirect("/workspaces?error=forbidden");
  const runs = await listPayrollRuns({ ctx, workspaceId: id });
  const selectedId = query.runId && runs.some((run) => run.id === query.runId) ? query.runId : runs[0]?.id;
  const run = selectedId ? await getPayrollRun({ ctx, workspaceId: id, runId: selectedId }) : null;
  return (
    <main className="page">
      <div className="page-head"><div><p className="eyebrow">Gaji</p><h1 className="page-title">Laporan gaji</h1><p className="page-subtitle">Ekspor CSV dan cetak slip per karyawan untuk payroll terpilih.</p></div>{run ? <a className="btn btn--primary" href={`/api/workspaces/${id}/payroll/runs/${run.id}/csv`}>Download CSV</a> : null}</div>
      <form method="get" className="toolbar"><label className="field">Periode payroll<select name="runId" defaultValue={run?.id ?? ""}>{runs.map((row) => <option key={row.id} value={row.id}>{String(row.periodMonth).padStart(2, "0")}/{row.periodYear} · {row.status}</option>)}</select></label><button className="btn btn--secondary">Tampilkan</button></form>
      {run ? (
        <div className="table-wrap"><div className="table-head"><div><h2 className="section-title">{String(run.periodMonth).padStart(2, "0")}/{run.periodYear}</h2><p className="section-note">{run.memberCount} karyawan · {run.status} · total net {money.format(run.totalNet)}</p></div><span className="badge badge--green">{run.currency}</span></div><div className="table-scroll"><table className="data"><thead><tr><th>Karyawan</th><th>Bruto</th><th>Potongan</th><th>Net</th><th>Slip</th></tr></thead><tbody>{run.items.map((item) => <tr key={item.id}><td><span className="cell-title">{item.memberName}</span><span className="cell-sub">{item.divisionName ?? "—"} · {item.spLevel ?? "tanpa SP"}</span></td><td className="num">{money.format(item.grossPay)}</td><td className="num">{money.format(item.totalDeductions)}</td><td className="num"><strong>{money.format(item.netPay)}</strong></td><td><a href={`/workspaces/${id}/payroll/slips/${run.id}?memberId=${item.memberId}`}>Cetak slip</a></td></tr>)}</tbody></table></div></div>
      ) : <p className="empty card card-pad">Belum ada payroll untuk dilaporkan.</p>}
    </main>
  );
}
