import { redirect } from "next/navigation";

import { getLeaveReport } from "@absensi/auth";

import { requirePagePermission } from "@/lib/page-auth";

export const dynamic = "force-dynamic";

export default async function LeaveReportPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ year?: string }>;
}) {
  const { id } = await params;
  const query = await searchParams;
  const { ctx } = await requirePagePermission("correction.review");
  if (!ctx || ctx.tenantId !== id) redirect("/workspaces?error=forbidden");
  const report = await getLeaveReport({
    ctx,
    workspaceId: id,
    year: query.year ?? undefined,
  });

  return (
    <main className="page">
      <div className="page-head">
        <div>
          <p className="eyebrow">Laporan & kuota</p>
          <h1 className="page-title">Laporan cuti</h1>
          <p className="page-subtitle">
            Rekap kuota, terpakai, pending, dan sisa cuti tahunan karyawan.
          </p>
        </div>
        <span className="badge badge--green">
          <span className="num">{report.annualQuotaDays}</span> hari / tahun
        </span>
      </div>

      <form method="get" className="toolbar">
        <label className="field" style={{ minWidth: "9rem" }}>
          Tahun
          <input
            type="number"
            name="year"
            min={2000}
            max={2100}
            defaultValue={report.year}
          />
        </label>
        <button type="submit" className="btn btn--primary">
          Tampilkan
        </button>
        <a
          className="btn btn--secondary"
          href={`/workspaces/${id}/leave/settings`}
          style={{ marginLeft: "auto" }}
        >
          Pengaturan cuti
        </a>
      </form>

      <div className="kpi-grid">
        <div className="kpi">
          <p className="kpi-label">Total kuota</p>
          <p className="kpi-value num">{report.totals.entitledDays}</p>
        </div>
        <div className="kpi">
          <p className="kpi-label">Terpakai</p>
          <p className="kpi-value num">{report.totals.usedDays}</p>
        </div>
        <div className="kpi">
          <p className="kpi-label">Sisa</p>
          <p className="kpi-value num">{report.totals.remainingDays}</p>
        </div>
        <div className="kpi">
          <p className="kpi-label">Pending</p>
          <p className="kpi-value num">{report.totals.pendingDays}</p>
        </div>
      </div>

      <div className="table-wrap">
        <div className="table-head">
          <div>
            <h2 className="section-title">Kuota per karyawan</h2>
            <p className="section-note">
              Tahun <span className="num">{report.year}</span> ·{" "}
              <span className="num">{report.rows.length}</span> karyawan aktif
            </p>
          </div>
        </div>
        <div className="table-scroll">
          <table className="data">
            <thead>
              <tr>
                <th>Karyawan</th>
                <th>Divisi</th>
                <th>Kuota</th>
                <th>Terpakai</th>
                <th>Pending</th>
                <th>Sisa</th>
              </tr>
            </thead>
            <tbody>
              {report.rows.length === 0 ? (
                <tr>
                  <td colSpan={6} className="empty">
                    Belum ada karyawan aktif.
                  </td>
                </tr>
              ) : null}
              {report.rows.map((row) => (
                <tr key={row.memberId}>
                  <td>
                    <span className="cell-title">{row.memberName}</span>
                    <span className="cell-sub">{row.memberEmail}</span>
                  </td>
                  <td>{row.divisionName ?? "—"}</td>
                  <td className="num">{row.entitledDays}</td>
                  <td className="num">{row.usedDays}</td>
                  <td className="num">{row.pendingDays}</td>
                  <td className="num">{row.remainingDays}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </main>
  );
}
