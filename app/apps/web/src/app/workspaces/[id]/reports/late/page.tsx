import Link from "next/link";
import { redirect } from "next/navigation";

import { getLateStats } from "@absensi/auth";

import { requirePagePermission } from "@/lib/page-auth";

export const dynamic = "force-dynamic";

function Bars({ rows }: { rows: Array<{ label: string; count: number }> }) {
  const max = Math.max(1, ...rows.map((row) => row.count));
  return (
    <div style={{ display: "grid", gap: "0.45rem" }}>
      {rows.map((row) => (
        <div key={row.label} className="bar-row">
          <span>{row.label}</span>
          <span className="bar-track" aria-hidden="true">
            <span
              className="bar-fill"
              style={{ display: "block", width: `${Math.max(4, (row.count / max) * 100)}%` }}
            />
          </span>
          <span className="bar-count" aria-label={`${row.count} kejadian`}>
            {row.count}
          </span>
        </div>
      ))}
    </div>
  );
}

export default async function LateStatsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ year?: string; month?: string }>;
}) {
  const { id } = await params;
  const query = await searchParams;
  const { ctx } = await requirePagePermission("attendance.read");
  if (!ctx || ctx.tenantId !== id) redirect("/workspaces?error=forbidden");

  const now = new Date();
  const stats = await getLateStats({
    ctx,
    workspaceId: id,
    year: Number(query.year ?? now.getUTCFullYear()),
    month: Number(query.month ?? now.getUTCMonth() + 1),
  });

  return (
    <main className="page page--narrow">
      <Link href={`/workspaces/${id}/reports`} className="back-link">
        ← Rekap bulanan
      </Link>
      <div className="page-head">
        <div>
          <p className="eyebrow">Disiplin waktu</p>
          <h1 className="page-title">Statistik keterlambatan</h1>
          <p className="page-subtitle">
            {stats.totalLate} kejadian · rata-rata {stats.averageLateMinutes} menit
          </p>
        </div>
      </div>

      <section className="card card-pad" style={{ marginBottom: "1rem" }}>
        <h2 className="section-title" style={{ marginBottom: "0.6rem" }}>
          Per hari
        </h2>
        {stats.lateByDay.length === 0 ? (
          <p className="empty">Tidak ada keterlambatan.</p>
        ) : (
          <Bars rows={stats.lateByDay.map((row) => ({ label: row.date, count: row.count }))} />
        )}
      </section>

      <section className="card card-pad">
        <h2 className="section-title" style={{ marginBottom: "0.6rem" }}>
          Per member
        </h2>
        {stats.lateByMember.length === 0 ? (
          <p className="empty">Tidak ada keterlambatan.</p>
        ) : (
          <Bars
            rows={stats.lateByMember.map((row) => ({ label: row.name, count: row.count }))}
          />
        )}
      </section>
    </main>
  );
}
