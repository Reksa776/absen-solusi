import Link from "next/link";
import { redirect } from "next/navigation";

import { getMonthlyReport, listDivisions } from "@absensi/auth";

import { requirePagePermission } from "@/lib/page-auth";

export const dynamic = "force-dynamic";

const STATUS_LABELS: Record<string, string> = {
  PRESENT: "Hadir",
  INCOMPLETE: "Belum check-out",
  ANOMALY: "Anomali waktu",
  ABSENT: "Absen",
  HOLIDAY: "Libur",
  WEEKEND: "Akhir pekan",
  FUTURE: "Belum terjadi",
};

const STATUS_BADGES: Record<string, string> = {
  PRESENT: "badge badge--green",
  INCOMPLETE: "badge badge--yellow",
  ANOMALY: "badge badge--yellow",
  ABSENT: "badge badge--red",
  HOLIDAY: "badge badge--neutral",
  WEEKEND: "badge badge--neutral",
  FUTURE: "badge badge--neutral",
};

function time(value: string | null, timeZone: string): string {
  if (!value) return "—";
  return new Intl.DateTimeFormat("id-ID", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(value));
}

export default async function ReportsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{
    year?: string;
    month?: string;
    memberId?: string;
    divisionId?: string;
  }>;
}) {
  const { id } = await params;
  const query = await searchParams;
  const { ctx } = await requirePagePermission("attendance.read");
  if (!ctx || ctx.tenantId !== id) redirect("/workspaces?error=forbidden");

  const now = new Date();
  const year = Number(query.year ?? now.getUTCFullYear());
  const month = Number(query.month ?? now.getUTCMonth() + 1);
  const divisionId = query.divisionId?.trim() || undefined;
  const report = await getMonthlyReport({
    ctx,
    workspaceId: id,
    year,
    month,
    memberId: query.memberId?.trim() || undefined,
    divisionId,
  });
  const divisions = ctx.permissions.includes("member.read")
    ? (await listDivisions({ ctx, workspaceId: id })).filter(
        (division) => division.isActive,
      )
    : [];
  const selectedDivision = divisions.find((division) => division.id === divisionId);
  const monthLabel = `${report.year}-${String(report.month).padStart(2, "0")}`;
  const timezone = report.timezone ?? "UTC";
  const exportQuery = new URLSearchParams({
    year: String(report.year),
    month: String(report.month),
    format: "csv",
  });
  if (divisionId) exportQuery.set("divisionId", divisionId);
  if (query.memberId) exportQuery.set("memberId", query.memberId);

  return (
    <main className="page">
      <div className="page-head">
        <div>
          <p className="eyebrow">Rekap bulanan</p>
          <h1 className="page-title">Rekap bulanan</h1>
          <p className="page-subtitle">
            Periode <span className="mono">{monthLabel}</span> ·{" "}
            <span className="num">{report.pagination.total}</span> member · Zona waktu {timezone}
            {selectedDivision ? ` · ${selectedDivision.name}` : ""}
          </p>
        </div>
        <div className="btn-row">
          <a
            className="btn btn--secondary"
            href={`/api/workspaces/${id}/reports/monthly/export?${exportQuery.toString()}`}
          >
            Unduh CSV
          </a>
          <Link
            className="btn btn--primary"
            href={`/workspaces/${id}/reports/late?year=${report.year}&month=${report.month}`}
          >
            Statistik keterlambatan
          </Link>
        </div>
      </div>

      <form method="get" className="toolbar">
        <label className="field" style={{ maxWidth: "7rem" }}>
          Tahun
          <input type="number" name="year" defaultValue={report.year} min={2000} max={2100} />
        </label>
        <label className="field" style={{ maxWidth: "5rem" }}>
          Bulan
          <input type="number" name="month" defaultValue={report.month} min={1} max={12} />
        </label>
        {divisions.length > 0 ? (
          <label className="field" style={{ maxWidth: "13rem" }}>
            Divisi
            <select name="divisionId" defaultValue={divisionId ?? ""}>
              <option value="">Semua divisi</option>
              {divisions.map((division) => (
                <option key={division.id} value={division.id}>
                  {division.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <button type="submit" className="btn btn--primary">
          Tampilkan
        </button>
      </form>

      <div className="report-list">
        {report.members.map((member) => (
          <details key={member.memberId} className="report-card">
            <summary>
              <strong>{member.name}</strong>
              {member.divisionName ? (
                <span className="badge badge--neutral">{member.divisionName}</span>
              ) : null}
              <span className="mono">{member.totalWorkHours} jam</span>
              <span className="mono">{member.totalLate} menit terlambat</span>
              <span className="mono">{member.totalAbsent} alpha</span>
            </summary>
            <div className="table-scroll">
              <table className="data">
                <thead>
                  <tr>
                    {["Tanggal", "Masuk", "Keluar", "Jam kerja", "Terlambat", "Status"].map((label) => (
                      <th key={label}>{label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {member.days.map((day) => (
                    <tr key={day.date}>
                      <td className="mono nowrap">{day.date}</td>
                      <td className="mono nowrap">{time(day.checkIn, timezone)}</td>
                      <td className="mono nowrap">{time(day.checkOut, timezone)}</td>
                      <td className="mono nowrap">{day.workHours}</td>
                      <td className={day.late > 0 ? "mono nowrap" : "muted"}>
                        {day.late > 0 ? `${day.late} menit` : "—"}
                      </td>
                      <td>
                        <span className={STATUS_BADGES[day.status] ?? "badge badge--neutral"}>
                          {STATUS_LABELS[day.status] ?? day.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        ))}
      </div>
    </main>
  );
}
