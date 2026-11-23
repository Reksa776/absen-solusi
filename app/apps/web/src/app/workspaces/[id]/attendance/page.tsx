import Link from "next/link";
import { redirect } from "next/navigation";

import { listAttendanceRecords, listWorkspaceMembers } from "@absensi/auth";

import { requirePagePermission } from "@/lib/page-auth";

export const dynamic = "force-dynamic";

function time(value: string): string {
  return new Intl.DateTimeFormat("id-ID", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(value));
}

export default async function DailyAttendancePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ date?: string; memberId?: string }>;
}) {
  const { id } = await params;
  const query = await searchParams;
  const { ctx } = await requirePagePermission("attendance.read");
  if (!ctx || ctx.tenantId !== id) redirect("/workspaces?error=forbidden");
  const date = query.date ?? new Date().toISOString().slice(0, 10);
  const [records, members] = await Promise.all([
    listAttendanceRecords({
      ctx,
      workspaceId: id,
      date,
      memberId: query.memberId || undefined,
      limit: 300,
    }),
    ctx.permissions.includes("member.read")
      ? listWorkspaceMembers({ ctx, workspaceId: id, limit: 100 })
      : Promise.resolve({ members: [] }),
  ]);
  const checkedIn = new Set(records.filter((row) => row.type === "CHECK_IN").map((row) => row.memberId));
  const checkedOut = new Set(records.filter((row) => row.type === "CHECK_OUT").map((row) => row.memberId));

  return (
    <main className="page">
      <div className="page-head">
        <div>
          <p className="eyebrow">Kehadiran</p>
          <h1 className="page-title">Kehadiran harian</h1>
          <p className="page-subtitle">
            <span className="num">{checkedIn.size}</span> karyawan masuk ·{" "}
            <span className="num">{checkedOut.size}</span> sudah pulang pada {date}.
          </p>
        </div>
        <div className="btn-row">
          <Link href={`/workspaces/${id}/attendance/notes`} className="btn btn--secondary">
            Rekap catatan
          </Link>
          <Link href={`/workspaces/${id}/attendance/summary`} className="btn btn--primary">
            Ringkasan bulanan
          </Link>
        </div>
      </div>

      <form method="get" className="toolbar">
        <label className="field">
          Tanggal
          <input type="date" name="date" defaultValue={date} className="mono" />
        </label>
        {members.members.length > 0 ? (
          <label className="field">
            Karyawan
            <select name="memberId" defaultValue={query.memberId ?? ""}>
              <option value="">Semua karyawan</option>
              {members.members.map((member) => (
                <option key={member.id} value={member.id}>
                  {member.user.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <button type="submit" className="btn btn--primary">
          Tampilkan
        </button>
      </form>

      <div className="table-wrap">
        <div className="table-scroll">
          <table className="data">
            <thead>
              <tr>
                {["Karyawan", "Tipe", "Jam server", "Lokasi", "Mode", "Status", "Foto"].map((label) => (
                  <th key={label}>{label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {records.length === 0 ? (
                <tr>
                  <td colSpan={7} className="empty">
                    Belum ada presensi pada tanggal ini.
                  </td>
                </tr>
              ) : null}
              {records.map((row) => (
                <tr key={row.id}>
                  <td>
                    <span className="cell-title">{row.memberName}</span>
                    <span className="cell-sub">{row.divisionName ?? row.memberEmail}</span>
                  </td>
                  <td>{row.type === "CHECK_IN" ? "Masuk" : "Pulang"}</td>
                  <td className="mono nowrap">{time(row.timestampServer)}</td>
                  <td>
                    <span className="cell-title">{row.officeName ?? "Tanpa kantor"}</span>
                    <span className="cell-sub mono">{Math.round(row.distanceMeters)} m</span>
                  </td>
                  <td>
                    <span className="badge badge--neutral">
                      {row.workMode === "OUT_OF_TOWN"
                        ? "Luar kota"
                        : row.workMode === "WFH"
                          ? "WFH"
                          : "Kantor"}
                    </span>
                  </td>
                  <td>
                    <span
                      className={
                        row.approvalStatus === "APPROVED"
                          ? "badge badge--green"
                          : row.approvalStatus === "REJECTED"
                            ? "badge badge--red"
                            : "badge badge--yellow"
                      }
                    >
                      {row.approvalStatus === "APPROVED"
                        ? "Disetujui"
                        : row.approvalStatus === "REJECTED"
                          ? "Ditolak"
                          : "Menunggu"}
                    </span>
                  </td>
                  <td>
                    <a href={row.photoUrl} target="_blank" rel="noreferrer">
                      Lihat
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </main>
  );
}
