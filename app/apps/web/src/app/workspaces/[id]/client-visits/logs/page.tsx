import { redirect } from "next/navigation";
import { listWorkspaceClientVisitLogs } from "@absensi/auth";
import { requirePagePermission } from "@/lib/page-auth";
import { VisitLogTable } from "@/components/phase-c-forms";

export const dynamic = "force-dynamic";

export default async function ClientVisitLogsPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ status?: string }> }) {
  const { id } = await params;
  const query = await searchParams;
  const { ctx } = await requirePagePermission("attendance.read");
  if (!ctx || ctx.tenantId !== id) redirect("/workspaces?error=forbidden");
  const canManage = ctx.permissions.includes("member.manage");
  const logs = await listWorkspaceClientVisitLogs({ ctx, workspaceId: id, validationStatus: query.status });
  return (
    <main className="page">
      <div className="page-head"><div><p className="eyebrow">Kunjungan client</p><h1 className="page-title">Log kunjungan</h1><p className="page-subtitle">GPS, jarak radius, foto bukti, catatan hasil, dan validasi atasan.</p></div><span className="badge badge--neutral"><span className="num">{logs.length}</span> log</span></div>
      <div className="toolbar"><a className="btn btn--secondary btn--sm" href={`/workspaces/${id}/client-visits/logs`}>Semua</a><a className="btn btn--secondary btn--sm" href={`/workspaces/${id}/client-visits/logs?status=OUT_OF_RADIUS`}>Luar radius</a><a className="btn btn--secondary btn--sm" href={`/workspaces/${id}/client-visits/logs?status=VALID`}>Valid</a><a className="btn btn--secondary btn--sm" href={`/workspaces/${id}/client-visits/logs?status=VOID`}>Void</a></div>
      <VisitLogTable
        workspaceId={id}
        canManage={canManage}
        logs={logs.map((log) => ({
          id: log.id,
          scheduleId: log.scheduleId,
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
