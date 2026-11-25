import Link from "next/link";
import { redirect } from "next/navigation";

import { getTodayDashboard, listWorkspaceWfh } from "@absensi/auth";

import { requirePagePermission } from "@/lib/page-auth";

export const dynamic = "force-dynamic";

const STATUS_LABELS: Record<string, string> = {
  PRESENT: "Tepat waktu",
  LATE: "Terlambat",
  ON_SITE: "Masih di kantor",
  ABSENT: "Absen",
  HOLIDAY: "Hari libur",
};

const STATUS_BADGES: Record<string, string> = {
  PRESENT: "badge badge--green",
  ON_SITE: "badge badge--green",
  LATE: "badge badge--yellow",
  ABSENT: "badge badge--red",
  HOLIDAY: "badge badge--neutral",
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

type KpiCard = {
  label: string;
  value: number;
  hint: string;
  bar?: number;
  tone?: "yellow" | "red";
};

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
  const canReviewWfh = ctx.permissions.includes("correction.review");
  const wfhPending = canReviewWfh
    ? await listWorkspaceWfh({ ctx, workspaceId: id, status: "PENDING" })
    : [];

  const timezone = dashboard.timezone ?? "UTC";
  const total = Math.max(1, dashboard.totalMembers);
  const pct = (value: number) => Math.min(100, Math.round((value / total) * 100));
  const cards: KpiCard[] = [
    { label: "Total member", value: dashboard.totalMembers, hint: "member aktif", bar: 100 },
    { label: "Sudah masuk", value: dashboard.checkedIn, hint: `${pct(dashboard.checkedIn)}% kehadiran`, bar: pct(dashboard.checkedIn) },
    { label: "Terlambat", value: dashboard.late, hint: "perlu perhatian", bar: pct(dashboard.late), tone: "yellow" },
    { label: "Absen", value: dashboard.absent, hint: "belum check-in", bar: pct(dashboard.absent), tone: "red" },
    { label: "Masih di kantor", value: dashboard.onSite, hint: "belum check-out", bar: pct(dashboard.onSite) },
    { label: "Revisi pending", value: dashboard.correctionsPending, hint: "menunggu review" },
    ...(canReviewWfh
      ? [
          {
            label: "WFH menunggu",
            value: wfhPending.length,
            hint: "pengajuan perlu review",
            tone: "yellow" as const,
          },
        ]
      : []),
  ];

  return (
    <main className="page">
      <div className="page-head">
        <div>
          <p className="eyebrow">Ringkasan operasional</p>
          <h1 className="page-title">Dashboard hari ini</h1>
          <p className="page-subtitle">
            {dashboard.date}
            {dashboard.holiday ? ` · Libur: ${dashboard.holiday}` : ""}
            {` · Zona waktu: ${timezone}`}
          </p>
        </div>
        <div className="btn-row">
          <Link href={`/workspaces/${id}/reports`} className="btn btn--secondary">
            Rekap bulanan
          </Link>
          <Link href={`/workspaces/${id}/corrections`} className="btn btn--primary">
            Tinjau revisi
          </Link>
        </div>
      </div>

      <section className="kpi-grid" aria-label="Ringkasan hari ini">
        {cards.map((card) => (
          <article key={card.label} className="kpi">
            <div className="kpi-label">{card.label}</div>
            <div className="kpi-value">{card.value}</div>
            {card.bar === undefined ? null : (
              <div
                className={`kpi-bar${card.tone ? ` kpi-bar--${card.tone}` : ""}`}
                aria-hidden="true"
              >
                <span style={{ width: `${card.bar}%` }} />
              </div>
            )}
            <div className="kpi-foot">{card.hint}</div>
          </article>
        ))}
      </section>

      {canReviewWfh ? (
        <section className="table-wrap" aria-label="Antrean persetujuan WFH">
          <div className="table-head">
            <div>
              <h2 className="section-title">Antrean persetujuan</h2>
              <p className="section-note">
                {wfhPending.length} pengajuan WFH menunggu keputusan
              </p>
            </div>
            <Link
              href={`/workspaces/${id}/wfh`}
              className="btn btn--secondary btn--sm"
            >
              Tinjau WFH
            </Link>
          </div>
          <div className="table-scroll">
            <table className="data">
              <thead>
                <tr>
                  {["Karyawan", "Tanggal", "Alasan", "Status", "Aksi"].map((label) => (
                    <th key={label}>{label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {wfhPending.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="empty">
                      Tidak ada pengajuan WFH yang menunggu.
                    </td>
                  </tr>
                ) : null}
                {wfhPending.slice(0, 5).map((row) => (
                  <tr key={row.id}>
                    <td>
                      <span className="cell-title">{row.memberName}</span>
                    </td>
                    <td className="mono nowrap">{row.date}</td>
                    <td style={{ maxWidth: "20rem" }}>{row.reason}</td>
                    <td>
                      <span className="badge badge--yellow">Menunggu</span>
                    </td>
                    <td className="nowrap">
                      <Link
                        href={`/workspaces/${id}/wfh`}
                        className="btn btn--secondary btn--sm"
                      >
                        Tinjau
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      <section className="table-wrap">
        <div className="table-head">
          <div>
            <h2 className="section-title">Status kehadiran</h2>
            <p className="section-note">Check-in dan check-out yang tercatat server</p>
          </div>
          <span className="badge badge--neutral">{dashboard.members.length} member</span>
        </div>
        <div className="table-scroll">
          <table className="data">
            <thead>
              <tr>
                {["Member", "Status", "Masuk", "Keluar", "Terlambat"].map((label) => (
                  <th key={label}>{label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {dashboard.members.length === 0 ? (
                <tr>
                  <td colSpan={5} className="empty">
                    Belum ada data kehadiran untuk tanggal ini.
                  </td>
                </tr>
              ) : null}
              {dashboard.members.map((member) => (
                <tr key={member.memberId}>
                  <td>
                    <span className="cell-title">{member.name}</span>
                  </td>
                  <td>
                    <span className={STATUS_BADGES[member.status] ?? "badge badge--neutral"}>
                      {STATUS_LABELS[member.status] ?? member.status}
                    </span>
                  </td>
                  <td className="mono nowrap">{time(member.checkIn, timezone)}</td>
                  <td className="mono nowrap">{time(member.checkOut, timezone)}</td>
                  <td className={member.lateMinutes > 0 ? "mono nowrap" : "muted"}>
                    {member.lateMinutes > 0 ? `${member.lateMinutes} menit` : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
