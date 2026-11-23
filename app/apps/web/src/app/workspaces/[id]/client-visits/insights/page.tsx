import Link from "next/link";
import { redirect } from "next/navigation";

import { getClientVisitInsights } from "@absensi/auth";

import { requirePagePermission } from "@/lib/page-auth";

export const dynamic = "force-dynamic";

const BADGES: Record<string, string> = {
  POSITIVE: "badge badge--green",
  WARNING: "badge badge--yellow",
  RECOMMENDATION: "badge badge--green",
  INFO: "badge badge--neutral",
};

export default async function ClientVisitInsightsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const { id } = await params;
  const query = await searchParams;
  const { ctx } = await requirePagePermission("attendance.read");
  if (!ctx || ctx.tenantId !== id) redirect("/workspaces?error=forbidden");
  const { summary, insights } = await getClientVisitInsights({
    ctx,
    workspaceId: id,
    from: query.from || undefined,
    to: query.to || undefined,
  });

  return (
    <main className="page page--narrow">
      <div className="page-head">
        <div>
          <p className="eyebrow">Kunjungan client</p>
          <h1 className="page-title">AI insight kunjungan</h1>
          <p className="page-subtitle">
            Analisis deterministik dari data riil periode {summary.from} sampai {summary.to}.
            Tidak memakai API eksternal.
          </p>
        </div>
        <Link href={`/workspaces/${id}/client-visits/summary`} className="btn btn--secondary">
          Ringkasan kunjungan
        </Link>
      </div>

      <div className="kpi-grid">
        <div className="kpi">
          <div className="kpi-label">Penyelesaian</div>
          <div className="kpi-value">{summary.completionRate}%</div>
          <div className="kpi-foot">{summary.completedSchedules} selesai</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Total kunjungan</div>
          <div className="kpi-value">{summary.totalVisits}</div>
          <div className="kpi-foot">check-in tercatat</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Durasi rata-rata</div>
          <div className="kpi-value">{summary.averageDurationMinutes}</div>
          <div className="kpi-foot">menit</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Luar radius</div>
          <div className="kpi-value">{summary.outOfRadiusVisits}</div>
          <div className="kpi-foot">perlu verifikasi</div>
        </div>
      </div>

      <div className="stack">
        {insights.map((insight) => (
          <section className="card card-pad" key={`${insight.type}-${insight.title}`}>
            <div className="notification-head">
              <strong>{insight.title}</strong>
              <span className={BADGES[insight.type] ?? "badge badge--neutral"}>
                {insight.type === "POSITIVE"
                  ? "Positif"
                  : insight.type === "WARNING"
                    ? "Perhatian"
                    : insight.type === "RECOMMENDATION"
                      ? "Rekomendasi"
                      : "Informasi"}
              </span>
            </div>
            <p>{insight.detail}</p>
          </section>
        ))}
        {insights.length === 0 ? (
          <p className="empty">Belum ada insight untuk periode ini.</p>
        ) : null}
      </div>
    </main>
  );
}
