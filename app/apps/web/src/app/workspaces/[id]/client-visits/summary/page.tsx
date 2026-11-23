import { redirect } from "next/navigation";
import { getClientVisitInsights } from "@absensi/auth";
import { requirePagePermission } from "@/lib/page-auth";

export const dynamic = "force-dynamic";

const INSIGHT_LABELS: Record<string, string> = { POSITIVE: "Positif", WARNING: "Perhatian", INFO: "Informasi", RECOMMENDATION: "Rekomendasi" };

export default async function ClientVisitSummaryPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ from?: string; to?: string }> }) {
  const { id } = await params;
  const query = await searchParams;
  const { ctx } = await requirePagePermission("attendance.read");
  if (!ctx || ctx.tenantId !== id) redirect("/workspaces?error=forbidden");
  const { summary, insights } = await getClientVisitInsights({ ctx, workspaceId: id, from: query.from, to: query.to });
  return (
    <main className="page">
      <div className="page-head"><div><p className="eyebrow">Kunjungan client</p><h1 className="page-title">Ringkasan &amp; AI insight</h1><p className="page-subtitle">Periode {summary.from} s/d {summary.to} · analisis deterministik dari data kunjungan riil.</p></div><a className="btn btn--secondary" href={`/workspaces/${id}/client-visits/logs`}>Buka log</a></div>
      <form method="get" className="toolbar"><label className="field">Dari<input type="date" name="from" defaultValue={summary.from} /></label><label className="field">Sampai<input type="date" name="to" defaultValue={summary.to} /></label><button className="btn btn--primary">Tampilkan</button></form>
      <section className="kpi-grid">
        <article className="kpi"><div className="kpi-label">Jadwal</div><div className="kpi-value">{summary.totalSchedules}</div><div className="kpi-foot">{summary.completedSchedules} selesai</div></article>
        <article className="kpi"><div className="kpi-label">Penyelesaian</div><div className="kpi-value">{summary.completionRate}%</div><div className="kpi-bar"><span style={{ width: `${summary.completionRate}%` }} /></div><div className="kpi-foot">target 90%</div></article>
        <article className="kpi"><div className="kpi-label">Kunjungan</div><div className="kpi-value">{summary.totalVisits}</div><div className="kpi-foot">check-in tercatat</div></article>
        <article className="kpi"><div className="kpi-label">Durasi rata-rata</div><div className="kpi-value">{summary.averageDurationMinutes}<span className="muted" style={{ fontSize: "0.9rem" }}> m</span></div><div className="kpi-foot">per kunjungan</div></article>
        <article className="kpi"><div className="kpi-label">Luar radius</div><div className="kpi-value">{summary.outOfRadiusVisits}</div><div className="kpi-foot">perlu verifikasi</div></article>
        <article className="kpi"><div className="kpi-label">Terlewat</div><div className="kpi-value">{summary.missedSchedules}</div><div className="kpi-foot">jadwal lampau</div></article>
      </section>
      <div className="stack-lg">
        <section className="card"><div className="card-head"><div><h2 className="section-title">AI insight kunjungan</h2><p className="section-note">Rekomendasi dihitung dari penyelesaian, durasi, radius, dan sebaran client.</p></div><span className="badge badge--green">{insights.length} insight</span></div><div className="card-pad stack">{insights.map((insight, index) => <div key={`${insight.title}-${index}`} className="notification" style={{ borderLeftColor: insight.type === "WARNING" ? "var(--yellow-500)" : "var(--green-700)" }}><div className="notification-head"><strong>{insight.title}</strong><span className={insight.type === "WARNING" ? "badge badge--yellow" : "badge badge--green"}>{INSIGHT_LABELS[insight.type] ?? insight.type}</span></div><p>{insight.detail}</p></div>)}</div></section>
        <div className="table-wrap"><div className="table-head"><div><h2 className="section-title">Per client</h2><p className="section-note">Penyelesaian dan produktivitas per perusahaan klien.</p></div></div><div className="table-scroll"><table className="data"><thead><tr><th>Client</th><th>Jadwal</th><th>Selesai</th><th>Penyelesaian</th><th>Kunjungan</th><th>Durasi</th><th>Luar radius</th></tr></thead><tbody>{summary.perClient.length === 0 ? <tr><td colSpan={7} className="empty">Belum ada data pada periode ini.</td></tr> : null}{summary.perClient.map((row) => <tr key={row.clientId}><td><span className="cell-title">{row.clientName}</span></td><td className="num">{row.schedules}</td><td className="num">{row.completed}</td><td className="num">{row.completionRate}%</td><td className="num">{row.visits}</td><td className="num">{row.averageDurationMinutes} m</td><td className="num">{row.outOfRadius}</td></tr>)}</tbody></table></div></div>
      </div>
    </main>
  );
}
