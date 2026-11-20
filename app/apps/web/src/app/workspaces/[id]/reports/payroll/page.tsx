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

  return (
    <main
      style={{
        fontFamily: "system-ui, sans-serif",
        maxWidth: "76rem",
        margin: "0 auto",
        padding: "3rem 1.5rem",
        lineHeight: 1.6,
      }}
    >
      <p>
        <Link href={`/workspaces/${id}/reports`}>← Rekap bulanan</Link>
      </p>
      <h1 style={{ fontSize: "1.5rem" }}>Rekap payroll</h1>
      <p style={{ color: "#555" }}>
        Periode {summary.from} s/d {summary.to} · {summary.members.length} karyawan
        {summary.timezone ? ` · ${summary.timezone}` : ""}
      </p>

      <form method="get" style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", marginBottom: "1rem" }}>
        <label>
          Dari
          <input
            type="date"
            name="from"
            required
            defaultValue={summary.from}
            style={{ padding: "0.4rem", marginLeft: "0.35rem" }}
          />
        </label>
        <label>
          Sampai
          <input
            type="date"
            name="to"
            required
            defaultValue={summary.to}
            style={{ padding: "0.4rem", marginLeft: "0.35rem" }}
          />
        </label>
        <button type="submit" style={{ padding: "0.5rem 0.75rem" }}>
          Tampilkan
        </button>
        <a
          href={`/api/workspaces/${id}/reports/payroll-summary/export?from=${summary.from}&to=${summary.to}&format=csv`}
          style={{ padding: "0.5rem 0.75rem" }}
        >
          Download CSV
        </a>
      </form>

      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.85rem" }}>
        <thead>
          <tr>
            {[
              "Karyawan",
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
            ].map((label) => (
              <th
                key={label}
                style={{ textAlign: "left", borderBottom: "1px solid #ccc", padding: "0.4rem" }}
              >
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {summary.members.map((member) => (
            <tr key={member.memberId}>
              <td style={{ padding: "0.4rem" }}>{member.name}</td>
              <td style={{ padding: "0.4rem" }}>{member.presentDays}</td>
              <td style={{ padding: "0.4rem" }}>{member.officeDays}</td>
              <td style={{ padding: "0.4rem" }}>{member.wfhDays}</td>
              <td style={{ padding: "0.4rem" }}>{member.holidayDays}</td>
              <td style={{ padding: "0.4rem" }}>{member.weekendDays}</td>
              <td style={{ padding: "0.4rem" }}>{member.absentDays}</td>
              <td style={{ padding: "0.4rem" }}>{member.lateIncidents}</td>
              <td style={{ padding: "0.4rem" }}>{member.lateMinutes}</td>
              <td style={{ padding: "0.4rem" }}>{member.workHours}</td>
              <td style={{ padding: "0.4rem" }}>{member.overtimeHours}</td>
            </tr>
          ))}
          {summary.members.length === 0 ? (
            <tr>
              <td colSpan={11} style={{ padding: "0.75rem", color: "#555" }}>
                Tidak ada karyawan aktif pada periode ini.
              </td>
            </tr>
          ) : null}
        </tbody>
        <tfoot>
          <tr style={{ fontWeight: 600, borderTop: "1px solid #ccc" }}>
            <td style={{ padding: "0.4rem" }}>Total</td>
            <td style={{ padding: "0.4rem" }}>{summary.totals.presentDays}</td>
            <td style={{ padding: "0.4rem" }}>{summary.totals.officeDays}</td>
            <td style={{ padding: "0.4rem" }}>{summary.totals.wfhDays}</td>
            <td style={{ padding: "0.4rem" }}>{summary.totals.holidayDays}</td>
            <td style={{ padding: "0.4rem" }}>{summary.totals.weekendDays}</td>
            <td style={{ padding: "0.4rem" }}>{summary.totals.absentDays}</td>
            <td style={{ padding: "0.4rem" }}>{summary.totals.lateIncidents}</td>
            <td style={{ padding: "0.4rem" }}>{summary.totals.lateMinutes}</td>
            <td style={{ padding: "0.4rem" }}>{summary.totals.workHours}</td>
            <td style={{ padding: "0.4rem" }}>{summary.totals.overtimeHours}</td>
          </tr>
        </tfoot>
      </table>
    </main>
  );
}
