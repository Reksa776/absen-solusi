import Link from "next/link";
import { redirect } from "next/navigation";

import { getPayrollSummary } from "@absensi/auth";

import { requirePagePermission } from "@/lib/page-auth";

export const dynamic = "force-dynamic";

export default async function AttendanceSummaryPage({
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
  const year = Number(query.year ?? now.getUTCFullYear());
  const month = Number(query.month ?? now.getUTCMonth() + 1);
  const from = `${year}-${String(month).padStart(2, "0")}-01`;
  const to = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
  const summary = await getPayrollSummary({ ctx, workspaceId: id, from, to });
  const period = `${year}-${String(month).padStart(2, "0")}`;

  return (
    <main className="page">
      <div className="page-head">
        <div>
          <p className="eyebrow">Rekap kehadiran</p>
          <h1 className="page-title">Ringkasan kehadiran</h1>
          <p className="page-subtitle">
            Periode <span className="mono">{period}</span> ·{" "}
            <span className="num">{summary.members.length}</span> karyawan aktif · zona waktu{" "}
            {summary.timezone ?? "UTC"}.
          </p>
        </div>
        <div className="btn-row">
          <Link href={`/workspaces/${id}/reports?year=${year}&month=${month}`} className="btn btn--secondary">
            Rekap detail
          </Link>
          <Link href={`/workspaces/${id}/reports/late?year=${year}&month=${month}`} className="btn btn--primary">
            Statistik terlambat
          </Link>
        </div>
      </div>

      <div className="kpi-grid">
        {[
          ["Hadir", summary.totals.presentDays, "hari"],
          ["Terlambat", summary.totals.lateMinutes, "menit"],
          ["Alpha", summary.totals.absentDays, "hari"],
          ["Jam kerja", summary.totals.workHours, "jam"],
          ["Lembur", summary.totals.overtimeHours, "jam"],
        ].map(([label, value, unit]) => (
          <div className="kpi" key={String(label)}>
            <div className="kpi-label">{label}</div>
            <div className="kpi-value">{value}</div>
            <div className="kpi-foot">{unit}</div>
          </div>
        ))}
      </div>

      <form method="get" className="toolbar">
        <label className="field" style={{ maxWidth: "7rem" }}>
          Tahun
          <input type="number" name="year" defaultValue={year} min={2000} max={2100} />
        </label>
        <label className="field" style={{ maxWidth: "5rem" }}>
          Bulan
          <input type="number" name="month" defaultValue={month} min={1} max={12} />
        </label>
        <button type="submit" className="btn btn--primary">
          Tampilkan
        </button>
      </form>

      <div className="table-wrap">
        <div className="table-scroll">
          <table className="data">
            <thead>
              <tr>
                {["Karyawan", "Hadir", "WFH", "Alpha", "Terlambat", "Jam kerja", "Lembur"].map((label) => (
                  <th key={label}>{label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {summary.members.map((member) => (
                <tr key={member.memberId}>
                  <td>
                    <span className="cell-title">{member.name}</span>
                  </td>
                  <td className="num">{member.presentDays}</td>
                  <td className="num">{member.wfhDays}</td>
                  <td className="num">{member.absentDays}</td>
                  <td className="num">{member.lateMinutes} m</td>
                  <td className="num">{member.workHours}</td>
                  <td className="num">{member.overtimeHours}</td>
                </tr>
              ))}
              {summary.members.length === 0 ? (
                <tr>
                  <td colSpan={7} className="empty">
                    Belum ada karyawan aktif.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>
    </main>
  );
}
