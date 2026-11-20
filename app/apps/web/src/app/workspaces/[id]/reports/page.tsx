import Link from "next/link";
import { redirect } from "next/navigation";

import { getMonthlyReport } from "@absensi/auth";

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
  searchParams: Promise<{ year?: string; month?: string; memberId?: string }>;
}) {
  const { id } = await params;
  const query = await searchParams;
  const { ctx } = await requirePagePermission("attendance.read");
  if (!ctx || ctx.tenantId !== id) redirect("/workspaces?error=forbidden");

  const now = new Date();
  const year = Number(query.year ?? now.getUTCFullYear());
  const month = Number(query.month ?? now.getUTCMonth() + 1);
  const report = await getMonthlyReport({
    ctx,
    workspaceId: id,
    year,
    month,
    memberId: query.memberId?.trim() || undefined,
  });
  const monthLabel = `${report.year}-${String(report.month).padStart(2, "0")}`;
  const timezone = report.timezone ?? "UTC";

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
        <Link href="/workspaces">← Workspace</Link>
      </p>
      <h1 style={{ fontSize: "1.5rem" }}>Rekap bulanan</h1>

      <form method="get" style={{ display: "flex", gap: "0.5rem", marginBottom: "1rem" }}>
        <label>
          Tahun
          <input
            type="number"
            name="year"
            defaultValue={report.year}
            min={2000}
            max={2100}
            style={{ padding: "0.4rem", marginLeft: "0.35rem", width: "6rem" }}
          />
        </label>
        <label>
          Bulan
          <input
            type="number"
            name="month"
            defaultValue={report.month}
            min={1}
            max={12}
            style={{ padding: "0.4rem", marginLeft: "0.35rem", width: "4rem" }}
          />
        </label>
        <button type="submit" style={{ padding: "0.5rem 0.75rem" }}>
          Tampilkan
        </button>
      </form>

      <p style={{ color: "#555" }}>
        Periode {monthLabel} · {report.pagination.total} member · Zona waktu {timezone}
      </p>
      <p>
        <a
          href={`/api/workspaces/${id}/reports/monthly/export?year=${report.year}&month=${report.month}&format=csv`}
        >
          Unduh CSV
        </a>
        {" · "}
        <Link href={`/workspaces/${id}/reports/late?year=${report.year}&month=${report.month}`}>
          Statistik keterlambatan
        </Link>
      </p>

      {report.members.map((member) => (
        <details
          key={member.memberId}
          style={{
            border: "1px solid #ddd",
            borderRadius: "0.5rem",
            padding: "0.75rem",
            marginBottom: "0.75rem",
          }}
        >
          <summary style={{ cursor: "pointer" }}>
            <strong>{member.name}</strong> · {member.totalWorkHours} jam ·{" "}
            {member.totalLate} menit terlambat · {member.totalAbsent} alpha
          </summary>
          <table
            style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.85rem", marginTop: "0.75rem" }}
          >
            <thead>
              <tr>
                {["Tanggal", "Masuk", "Keluar", "Jam kerja", "Terlambat", "Status"].map((label) => (
                  <th
                    key={label}
                    style={{ textAlign: "left", borderBottom: "1px solid #ccc", padding: "0.35rem" }}
                  >
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {member.days.map((day) => (
                <tr key={day.date}>
                  <td style={{ padding: "0.35rem" }}>{day.date}</td>
                  <td style={{ padding: "0.35rem" }}>{time(day.checkIn, timezone)}</td>
                  <td style={{ padding: "0.35rem" }}>{time(day.checkOut, timezone)}</td>
                  <td style={{ padding: "0.35rem" }}>{day.workHours}</td>
                  <td style={{ padding: "0.35rem" }}>
                    {day.late > 0 ? `${day.late} menit` : "—"}
                  </td>
                  <td style={{ padding: "0.35rem" }}>
                    {STATUS_LABELS[day.status] ?? day.status}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      ))}
    </main>
  );
}
