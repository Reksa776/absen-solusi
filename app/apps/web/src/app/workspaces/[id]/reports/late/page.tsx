import Link from "next/link";
import { redirect } from "next/navigation";

import { getLateStats } from "@absensi/auth";

import { requirePagePermission } from "@/lib/page-auth";

export const dynamic = "force-dynamic";

function Bars({ rows }: { rows: Array<{ label: string; count: number }> }) {
  const max = Math.max(1, ...rows.map((row) => row.count));
  return (
    <div style={{ display: "grid", gap: "0.4rem" }}>
      {rows.map((row) => (
        <div key={row.label} style={{ display: "grid", gridTemplateColumns: "10rem 1fr 3rem" }}>
          <span style={{ fontSize: "0.85rem" }}>{row.label}</span>
          <span
            aria-hidden
            style={{
              background: "#00695c",
              borderRadius: "0.25rem",
              height: "1rem",
              width: `${Math.max(4, (row.count / max) * 100)}%`,
            }}
          />
          <span style={{ fontSize: "0.85rem" }}>{row.count}</span>
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
    <main
      style={{
        fontFamily: "system-ui, sans-serif",
        maxWidth: "60rem",
        margin: "0 auto",
        padding: "3rem 1.5rem",
        lineHeight: 1.6,
      }}
    >
      <p>
        <Link href={`/workspaces/${id}/reports`}>← Rekap bulanan</Link>
      </p>
      <h1 style={{ fontSize: "1.5rem" }}>Statistik keterlambatan</h1>
      <p style={{ color: "#555" }}>
        {stats.totalLate} kejadian · rata-rata {stats.averageLateMinutes} menit
      </p>

      <h2 style={{ fontSize: "1.1rem" }}>Per hari</h2>
      {stats.lateByDay.length === 0 ? (
        <p style={{ color: "#555" }}>Tidak ada keterlambatan.</p>
      ) : (
        <Bars rows={stats.lateByDay.map((row) => ({ label: row.date, count: row.count }))} />
      )}

      <h2 style={{ fontSize: "1.1rem", marginTop: "1.5rem" }}>Per member</h2>
      {stats.lateByMember.length === 0 ? (
        <p style={{ color: "#555" }}>Tidak ada keterlambatan.</p>
      ) : (
        <Bars
          rows={stats.lateByMember.map((row) => ({ label: row.name, count: row.count }))}
        />
      )}
    </main>
  );
}
