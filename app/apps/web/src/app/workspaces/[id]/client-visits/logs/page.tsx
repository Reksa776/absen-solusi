import { redirect } from "next/navigation";
import { listWorkspaceClientVisitLogs } from "@absensi/auth";
import { requirePagePermission } from "@/lib/page-auth";
import { VisitLogTable } from "@/components/phase-c-forms";

export const dynamic = "force-dynamic";

export default async function ClientVisitLogsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ status?: string; from?: string; to?: string }>;
}) {
  const { id } = await params;
  const query = await searchParams;
  const { ctx } = await requirePagePermission("attendance.read");
  if (!ctx || ctx.tenantId !== id) redirect("/workspaces?error=forbidden");
  const canManage = ctx.permissions.includes("member.manage");
  const logs = await listWorkspaceClientVisitLogs({
    ctx,
    workspaceId: id,
    validationStatus: query.status,
    from: query.from,
    to: query.to,
  });
  const exportQuery = new URLSearchParams();
  if (query.from) exportQuery.set("from", query.from);
  if (query.to) exportQuery.set("to", query.to);

  return (
    <main className="page">
      <div className="page-head">
        <div>
          <p className="eyebrow">Kunjungan client</p>
          <h1 className="page-title">Log kunjungan</h1>
          <p className="page-subtitle">
            GPS, jarak radius, foto bukti, catatan hasil, dan validasi atasan.
          </p>
        </div>
        <span className="badge badge--neutral">
          <span className="num">{logs.length}</span> log
        </span>
      </div>
      <form method="get" className="toolbar">
        <label className="field">
          Dari tanggal
          <input type="date" name="from" defaultValue={query.from ?? ""} />
        </label>
        <label className="field">
          Sampai tanggal
          <input type="date" name="to" defaultValue={query.to ?? ""} />
        </label>
        <label className="field">
          Status
          <select name="status" defaultValue={query.status ?? ""}>
            <option value="">Semua</option>
            <option value="OUT_OF_RADIUS">Luar radius</option>
            <option value="VALID">Valid</option>
            <option value="VOID">Void</option>
          </select>
        </label>
        <button className="btn btn--primary" type="submit">Tampilkan</button>
        <a
          className="btn btn--secondary"
          href={`/api/workspaces/${id}/client-visits/export.xlsx?${exportQuery.toString()}`}
        >
          Download Laporan Excel (.xlsx)
        </a>
      </form>
      <VisitLogTable
        workspaceId={id}
        canManage={canManage}
        logs={logs.map((log) => ({
          id: log.id,
          clientName: log.clientName,
          memberName: log.memberName,
          type: log.type,
          timestampServer: log.timestampServer,
          distanceMeters: log.distanceMeters,
          isInsideRadius: log.isInsideRadius,
          notes: log.notes,
          durationMinutes: log.durationMinutes,
          validationStatus: log.validationStatus,
          hasPhoto: Boolean(log.photoUrl),
        }))}
      />
    </main>
  );
}
