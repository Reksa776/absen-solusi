import { redirect } from "next/navigation";

import { listAttendanceRecords, listWorkspaceMembers } from "@absensi/auth";

import { requirePagePermission } from "@/lib/page-auth";

export const dynamic = "force-dynamic";

function dateTime(value: string): string {
  return new Intl.DateTimeFormat("id-ID", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export default async function AttendanceNotesPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{
    from?: string;
    to?: string;
    type?: string;
    approvalStatus?: string;
    memberId?: string;
  }>;
}) {
  const { id } = await params;
  const query = await searchParams;
  const { ctx } = await requirePagePermission("attendance.read");
  if (!ctx || ctx.tenantId !== id) redirect("/workspaces?error=forbidden");
  const today = new Date().toISOString().slice(0, 10);
  const from = query.from ?? `${today.slice(0, 8)}01`;
  const to = query.to ?? today;
  const [records, members] = await Promise.all([
    listAttendanceRecords({
      ctx,
      workspaceId: id,
      from,
      to,
      type: query.type || undefined,
      approvalStatus: query.approvalStatus || undefined,
      memberId: query.memberId || undefined,
      limit: 500,
    }),
    ctx.permissions.includes("member.read")
      ? listWorkspaceMembers({ ctx, workspaceId: id, limit: 100 })
      : Promise.resolve({ members: [] }),
  ]);
  const exportQuery = new URLSearchParams({
    from,
    to,
    ...(query.type ? { type: query.type } : {}),
    ...(query.approvalStatus ? { approvalStatus: query.approvalStatus } : {}),
    ...(query.memberId ? { memberId: query.memberId } : {}),
  });

  return (
    <main className="page">
      <div className="page-head">
        <div>
          <p className="eyebrow">Audit presensi</p>
          <h1 className="page-title">Rekap catatan presensi</h1>
          <p className="page-subtitle">
            Log kronologis <span className="num">{records.length}</span> transaksi masuk/pulang,
            lengkap dengan GPS, jarak, perangkat, wajah, foto, dan catatan.
          </p>
        </div>
        <a
          className="btn btn--secondary"
          href={`/api/workspaces/${id}/attendance/records/export?${exportQuery.toString()}`}
        >
          Unduh CSV
        </a>
      </div>

      <form method="get" className="toolbar">
        <label className="field">
          Dari
          <input type="date" name="from" defaultValue={from} className="mono" />
        </label>
        <label className="field">
          Sampai
          <input type="date" name="to" defaultValue={to} className="mono" />
        </label>
        <label className="field">
          Tipe
          <select name="type" defaultValue={query.type ?? ""}>
            <option value="">Semua</option>
            <option value="CHECK_IN">Masuk</option>
            <option value="CHECK_OUT">Pulang</option>
          </select>
        </label>
        <label className="field">
          Status
          <select name="approvalStatus" defaultValue={query.approvalStatus ?? ""}>
            <option value="">Semua</option>
            <option value="PENDING">Menunggu</option>
            <option value="APPROVED">Disetujui</option>
            <option value="REJECTED">Ditolak</option>
          </select>
        </label>
        {members.members.length > 0 ? (
          <label className="field">
            Karyawan
            <select name="memberId" defaultValue={query.memberId ?? ""}>
              <option value="">Semua</option>
              {members.members.map((member) => (
                <option key={member.id} value={member.id}>
                  {member.user.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <button type="submit" className="btn btn--primary">
          Filter
        </button>
      </form>

      <div className="table-wrap">
        <div className="table-scroll">
          <table className="data">
            <thead>
              <tr>
                {[
                  "Waktu",
                  "Karyawan",
                  "Tipe",
                  "GPS",
                  "Jarak",
                  "Perangkat",
                  "Wajah",
                  "Foto",
                  "Catatan",
                ].map((label) => (
                  <th key={label}>{label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {records.length === 0 ? (
                <tr>
                  <td colSpan={9} className="empty">
                    Tidak ada catatan presensi pada filter ini.
                  </td>
                </tr>
              ) : null}
              {records.map((row) => (
                <tr key={row.id}>
                  <td className="mono nowrap">{dateTime(row.timestampServer)}</td>
                  <td>
                    <span className="cell-title">{row.memberName}</span>
                    <span className="cell-sub">{row.divisionName ?? row.memberEmail}</span>
                  </td>
                  <td>
                    <span className="badge badge--neutral">
                      {row.type === "CHECK_IN" ? "Masuk" : "Pulang"}
                    </span>
                  </td>
                  <td className="mono nowrap">
                    {row.latitude.toFixed(5)}, {row.longitude.toFixed(5)}
                  </td>
                  <td className="num nowrap">
                    {Math.round(row.distanceMeters)} m
                    {row.outOfRadius ? (
                      <span className="badge badge--yellow" style={{ marginLeft: 4 }}>
                        Luar
                      </span>
                    ) : null}
                  </td>
                  <td className="muted" style={{ maxWidth: "10rem" }}>
                    {row.deviceInfo ?? "—"}
                  </td>
                  <td>
                    <span className={row.faceVerified ? "badge badge--green" : "badge badge--neutral"}>
                      {row.faceVerified ? "Terverifikasi" : "Belum"}
                    </span>
                  </td>
                  <td>
                    <a href={row.photoUrl} target="_blank" rel="noreferrer">
                      Selfie
                    </a>
                  </td>
                  <td className="muted" style={{ maxWidth: "14rem" }}>
                    {row.notes ?? row.outOfTownReason ?? "—"}
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
