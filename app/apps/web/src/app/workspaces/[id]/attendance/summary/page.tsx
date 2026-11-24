import Link from "next/link";
import { redirect } from "next/navigation";

import { getAttendancePeriodSummary } from "@absensi/auth";

import { requirePagePermission } from "@/lib/page-auth";
import { PrintButton } from "./print-button";

export const dynamic = "force-dynamic";

function day(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function validDay(value: string | undefined): value is string {
  return value !== undefined && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

export default async function AttendanceSummaryPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ startDate?: string; endDate?: string }>;
}) {
  const { id } = await params;
  const query = await searchParams;
  const { ctx } = await requirePagePermission("attendance.read");
  if (!ctx || ctx.tenantId !== id) redirect("/workspaces?error=forbidden");
  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const startDate = validDay(query.startDate) ? query.startDate : day(monthStart);
  const endDate = validDay(query.endDate) ? query.endDate : day(now);
  const summary = await getAttendancePeriodSummary({
    ctx,
    workspaceId: id,
    startDate,
    endDate,
  });
  const previousMonthEnd = new Date(monthStart.getTime() - 86_400_000);
  const previousMonthStart = new Date(
    Date.UTC(previousMonthEnd.getUTCFullYear(), previousMonthEnd.getUTCMonth(), 1),
  );
  const currentQuery = `startDate=${startDate}&endDate=${endDate}`;

  const metrics = [
    ["Hadir", summary.totals.presentDays, "hari"],
    ["Tepat waktu", summary.totals.onTimeDays, "hari"],
    ["Terlambat", summary.totals.lateMinutes, "menit"],
    ["Pulang cepat", summary.totals.earlyLeaveDays, "hari"],
    ["Izin", summary.totals.permitDays, "hari"],
    ["Cuti", summary.totals.leaveDays, "hari"],
    ["Luar kota", summary.totals.outOfTownDays, "hari"],
    ["Alpa", summary.totals.absentDays, "hari"],
  ] as const;

  return (
    <main className="page">
      <div className="page-head">
        <div>
          <p className="eyebrow">Rekap kehadiran</p>
          <h1 className="page-title">Ringkasan kehadiran</h1>
          <p className="page-subtitle">
            Periode <span className="mono">{summary.startDate}</span> sampai{" "}
            <span className="mono">{summary.endDate}</span> ·{" "}
            <span className="num">{summary.members.length}</span> karyawan aktif · zona waktu{" "}
            {summary.timezone ?? "UTC"}.
          </p>
        </div>
        <div className="btn-row">
          <a
            href={`/api/workspaces/${id}/attendance/summary/export?${currentQuery}`}
            className="btn btn--secondary"
          >
            Export CSV
          </a>
          <PrintButton />
        </div>
      </div>

      <div className="kpi-grid">
        {metrics.map(([label, value, unit]) => (
          <div className="kpi" key={label}>
            <div className="kpi-label">{label}</div>
            <div className="kpi-value num">{value}</div>
            <div className="kpi-foot">{unit}</div>
          </div>
        ))}
      </div>

      <form method="get" className="toolbar toolbar--wrap">
        <label className="field">
          Dari tanggal
          <input type="date" name="startDate" defaultValue={startDate} className="mono" />
        </label>
        <label className="field">
          Sampai tanggal
          <input type="date" name="endDate" defaultValue={endDate} className="mono" />
        </label>
        <button type="submit" className="btn btn--primary">
          Tampilkan periode
        </button>
        <Link
          href={`/workspaces/${id}/attendance/summary?startDate=${day(monthStart)}&endDate=${day(now)}`}
          className="btn btn--secondary"
        >
          Bulan ini
        </Link>
        <Link
          href={`/workspaces/${id}/attendance/summary?startDate=${day(previousMonthStart)}&endDate=${day(previousMonthEnd)}`}
          className="btn btn--secondary"
        >
          Bulan lalu
        </Link>
      </form>

      <div className="table-wrap">
        <div className="table-head">
          <div>
            <h2 className="section-title">Rekap per karyawan</h2>
            <p className="section-note">
              Cut-off fleksibel, termasuk periode lintas bulan untuk penggajian.
            </p>
          </div>
        </div>
        <div className="table-scroll">
          <table className="data">
            <thead>
              <tr>
                {["Karyawan", "Hadir", "Tepat waktu", "Terlambat", "Pulang cepat", "Izin", "Cuti", "Luar kota", "Alpa"].map(
                  (label) => (
                    <th key={label}>{label}</th>
                  ),
                )}
              </tr>
            </thead>
            <tbody>
              {summary.members.map((member) => (
                <tr key={member.memberId}>
                  <td>
                    <span className="cell-title">{member.name}</span>
                    <span className="cell-sub">{member.divisionName ?? "Tanpa divisi"}</span>
                  </td>
                  <td className="num">{member.presentDays}</td>
                  <td className="num">{member.onTimeDays}</td>
                  <td className="num">{member.lateMinutes} m</td>
                  <td className="num">{member.earlyLeaveDays}</td>
                  <td className="num">{member.permitDays}</td>
                  <td className="num">{member.leaveDays}</td>
                  <td className="num">{member.outOfTownDays}</td>
                  <td className="num">{member.absentDays}</td>
                </tr>
              ))}
              {summary.members.length === 0 ? (
                <tr>
                  <td colSpan={9} className="empty">
                    Belum ada karyawan aktif pada periode ini.
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
