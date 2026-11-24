import Link from "next/link";
import { redirect } from "next/navigation";

import { listAttendanceRecords, listWorkspaceMembers } from "@absensi/auth";

import { requirePagePermission } from "@/lib/page-auth";
import { AttendanceDetail, type AttendanceDetailGroup } from "./attendance-detail";

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
      limit: 500,
    }),
    ctx.permissions.includes("member.read")
      ? listWorkspaceMembers({ ctx, workspaceId: id, limit: 100 })
      : Promise.resolve({ members: [] }),
  ]);

  const groups = new Map<string, AttendanceDetailGroup>();
  for (const row of records) {
    const group =
      groups.get(row.memberId) ??
      ({
        memberId: row.memberId,
        memberName: row.memberName,
        memberEmail: row.memberEmail,
        divisionName: row.divisionName,
        checkIn: null,
        checkOut: null,
      } satisfies AttendanceDetailGroup);
    if (row.type === "CHECK_IN" && !group.checkIn) group.checkIn = row;
    if (row.type === "CHECK_OUT" && !group.checkOut) group.checkOut = row;
    groups.set(row.memberId, group);
  }
  const rows = [...groups.values()];
  const checkedIn = rows.filter((row) => row.checkIn !== null).length;
  const checkedOut = rows.filter((row) => row.checkOut !== null).length;

  return (
    <main className="page">
      <div className="page-head">
        <div>
          <p className="eyebrow">Kehadiran</p>
          <h1 className="page-title">Kehadiran harian</h1>
          <p className="page-subtitle">
            <span className="num">{checkedIn}</span> karyawan masuk ·{" "}
            <span className="num">{checkedOut}</span> sudah pulang pada {date}.
          </p>
        </div>
        <div className="btn-row">
          <Link href={`/workspaces/${id}/attendance/notes`} className="btn btn--secondary">
            Rekap catatan
          </Link>
          <Link href={`/workspaces/${id}/attendance/summary`} className="btn btn--primary">
            Ringkasan periode
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
        <div className="table-head">
          <div>
            <h2 className="section-title">Presensi karyawan</h2>
            <p className="section-note">
              Klik Lihat Detail untuk selfie masuk/pulang, GPS, peta, dan perangkat.
            </p>
          </div>
        </div>
        <div className="table-scroll">
          <table className="data">
            <thead>
              <tr>
                {["Karyawan", "Masuk", "Pulang", "Lokasi masuk", "Mode", "Status", "Aksi"].map(
                  (label) => (
                    <th key={label}>{label}</th>
                  ),
                )}
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={7} className="empty">
                    Belum ada presensi pada tanggal ini.
                  </td>
                </tr>
              ) : null}
              {rows.map((row) => {
                const primary = row.checkIn ?? row.checkOut;
                return (
                  <tr key={row.memberId}>
                    <td>
                      <span className="cell-title">{row.memberName}</span>
                      <span className="cell-sub">{row.divisionName ?? row.memberEmail}</span>
                    </td>
                    <td className="mono nowrap">{row.checkIn ? time(row.checkIn.timestampServer) : "—"}</td>
                    <td className="mono nowrap">{row.checkOut ? time(row.checkOut.timestampServer) : "—"}</td>
                    <td>
                      <span className="cell-title">{primary?.officeName ?? "Tanpa kantor"}</span>
                      <span className="cell-sub mono">
                        {primary ? `${Math.round(primary.distanceMeters)} m` : "—"}
                      </span>
                    </td>
                    <td>
                      <span className="badge badge--neutral">
                        {primary
                          ? primary.workMode === "OUT_OF_TOWN"
                            ? "Luar kota"
                            : primary.workMode === "WFH"
                              ? "WFH"
                              : "Kantor"
                          : "—"}
                      </span>
                    </td>
                    <td>
                      <span
                        className={
                          primary?.approvalStatus === "APPROVED"
                            ? "badge badge--green"
                            : primary?.approvalStatus === "REJECTED"
                              ? "badge badge--red"
                              : "badge badge--yellow"
                        }
                      >
                        {primary
                          ? primary.approvalStatus === "APPROVED"
                            ? "Disetujui"
                            : primary.approvalStatus === "REJECTED"
                              ? "Ditolak"
                              : "Menunggu"
                          : "—"}
                      </span>
                    </td>
                    <td>
                      <AttendanceDetail group={row} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </main>
  );
}
