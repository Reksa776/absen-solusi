import Link from "next/link";
import { redirect } from "next/navigation";

import { getTodayDashboard } from "@absensi/auth";

import { requirePagePermission } from "@/lib/page-auth";

export const dynamic = "force-dynamic";

const STATUS_LABELS: Record<string, string> = {
  PRESENT: "Tepat waktu",
  LATE: "Terlambat",
  ON_SITE: "Masih di kantor",
  ABSENT: "Absen",
  HOLIDAY: "Hari libur",
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

export default async function DashboardPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ date?: string }>;
}) {
  const { id } = await params;
  const query = await searchParams;
  const { ctx } = await requirePagePermission("attendance.read");
  if (!ctx || ctx.tenantId !== id) redirect("/workspaces?error=forbidden");

  const dashboard = await getTodayDashboard({
    ctx,
    workspaceId: id,
    date: query.date?.trim() || undefined,
  });

  const timezone = dashboard.timezone ?? "UTC";
  const cards = [
    ["Total member", dashboard.totalMembers],
    ["Sudah masuk", dashboard.checkedIn],
    ["Terlambat", dashboard.late],
    ["Absen", dashboard.absent],
    ["Masih di kantor", dashboard.onSite],
    ["Revisi pending", dashboard.correctionsPending],
  ] as const;

  return (
    <main
      style={{
        fontFamily: "system-ui, sans-serif",
        maxWidth: "72rem",
        margin: "0 auto",
        padding: "3rem 1.5rem",
        lineHeight: 1.6,
      }}
    >
      <p>
        <Link href="/workspaces">← Workspace</Link>
      </p>
      <h1 style={{ fontSize: "1.5rem" }}>Dashboard hari ini</h1>
      <p style={{ color: "#555" }}>
        {dashboard.date}
        {dashboard.holiday ? ` · Libur: ${dashboard.holiday}` : ""}
        {` · Zona waktu: ${timezone}`}
      </p>

      <section
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(10rem, 1fr))",
          gap: "0.75rem",
          marginBottom: "1.5rem",
        }}
      >
        {cards.map(([label, value]) => (
          <div
            key={label}
            style={{ border: "1px solid #ddd", borderRadius: "0.5rem", padding: "0.75rem" }}
          >
            <div style={{ color: "#555", fontSize: "0.85rem" }}>{label}</div>
            <div style={{ fontSize: "1.5rem", fontWeight: 600 }}>{value}</div>
          </div>
        ))}
      </section>

      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.9rem" }}>
        <thead>
          <tr>
            {["Member", "Status", "Masuk", "Keluar", "Terlambat"].map((label) => (
              <th
                key={label}
                style={{ textAlign: "left", borderBottom: "1px solid #ccc", padding: "0.5rem" }}
              >
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {dashboard.members.map((member) => (
            <tr key={member.memberId}>
              <td style={{ padding: "0.5rem" }}>{member.name}</td>
              <td style={{ padding: "0.5rem" }}>{STATUS_LABELS[member.status] ?? member.status}</td>
              <td style={{ padding: "0.5rem" }}>{time(member.checkIn, timezone)}</td>
              <td style={{ padding: "0.5rem" }}>{time(member.checkOut, timezone)}</td>
              <td style={{ padding: "0.5rem" }}>
                {member.lateMinutes > 0 ? `${member.lateMinutes} menit` : "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
