import Link from "next/link";
import { redirect } from "next/navigation";

import { getPayrollSummary } from "@absensi/auth";

import { requirePagePermission } from "@/lib/page-auth";

export const dynamic = "force-dynamic";

function defaultRange(): { from: string; to: string } {
  const now = new Date();
  const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  return {
    from: from.toISOString().slice(0, 10),
    to: now.toISOString().slice(0, 10),
  };
}

export default async function PayrollPage({
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
  const range = defaultRange();
  const from = query.from?.trim() || range.from;
  const to = query.to?.trim() || range.to;
  const summary = await getPayrollSummary({
    ctx,
    workspaceId: id,
    from,
    to,
  });

  const columns = [
    "Hadir",
    "Office",
    "WFH",
    "Libur",
    "Weekend",
    "Alpha",
    "Terlambat",
    "Menit telat",
    "Jam kerja",
    "Lembur (jam)",
  ];

  return (
    <main className="page">
      <div className="page-head">
        <div>
          <p className="eyebrow">Payroll</p>
          <h1 className="page-title">Rekap payroll</h1>
          <p className="page-subtitle">
            Periode {summary.from} s/d {summary.to} · {summary.members.length} karyawan
            {summary.timezone ? ` · ${summary.timezone}` : ""}
          </p>
        </div>
        <a
          className="btn btn--secondary"
          href={`/api/workspaces/${id}/reports/payroll-summary/export?from=${summary.from}&to=${summary.to}&format=csv`}
        >
          Download CSV
        </a>
      </div>

      <form method="get" className="toolbar">
        <label className="field">
          Dari
          <input type="date" name="from" required defaultValue={summary.from} />
        </label>
        <label className="field">
          Sampai
          <input type="date" name="to" required defaultValue={summary.to} />
        </label>
        <button type="submit" className="btn btn--primary">
          Tampilkan
        </button>
      </form>

      <div className="table-wrap">
        <div className="table-head">
          <div>
            <h2 className="section-title">Ringkasan per karyawan</h2>
            <p className="section-note">Angka siap dipakai untuk perhitungan payroll</p>
          </div>
          <span className="badge badge--yellow">{summary.members.length} karyawan</span>
        </div>
        <div className="table-scroll">
          <table className="data">
            <thead>
              <tr>
                <th>Karyawan</th>
                {columns.map((label) => (
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
                  <td className="num">{member.officeDays}</td>
                  <td className="num">{member.wfhDays}</td>
                  <td className="num">{member.holidayDays}</td>
                  <td className="num">{member.weekendDays}</td>
                  <td className="num">{member.absentDays}</td>
                  <td className="num">{member.lateIncidents}</td>
                  <td className="num">{member.lateMinutes}</td>
                  <td className="num">{member.workHours}</td>
                  <td className="num">{member.overtimeHours}</td>
                </tr>
              ))}
              {summary.members.length === 0 ? (
                <tr>
                  <td colSpan={11} className="empty">
                    Tidak ada karyawan aktif pada periode ini.
                  </td>
                </tr>
              ) : null}
            </tbody>
            <tfoot>
              <tr>
                <td>Total</td>
                <td className="num">{summary.totals.presentDays}</td>
                <td className="num">{summary.totals.officeDays}</td>
                <td className="num">{summary.totals.wfhDays}</td>
                <td className="num">{summary.totals.holidayDays}</td>
                <td className="num">{summary.totals.weekendDays}</td>
                <td className="num">{summary.totals.absentDays}</td>
                <td className="num">{summary.totals.lateIncidents}</td>
                <td className="num">{summary.totals.lateMinutes}</td>
                <td className="num">{summary.totals.workHours}</td>
                <td className="num">{summary.totals.overtimeHours}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </main>
  );
}
