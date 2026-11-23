import { redirect } from "next/navigation";
import { listClients, listWorkspaceClientVisitSchedules, listWorkspaceMembers } from "@absensi/auth";
import { requirePagePermission } from "@/lib/page-auth";
import { ScheduleManager } from "@/components/phase-c-forms";

export const dynamic = "force-dynamic";

export default async function ClientVisitsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { ctx } = await requirePagePermission("attendance.read");
  if (!ctx || ctx.tenantId !== id) redirect("/workspaces?error=forbidden");
  const canManage = ctx.permissions.includes("member.manage");
  const [clients, scheduleRows, memberResult] = await Promise.all([
    listClients({ ctx, workspaceId: id, activeOnly: true }),
    listWorkspaceClientVisitSchedules({ ctx, workspaceId: id }),
    canManage ? listWorkspaceMembers({ ctx, workspaceId: id, limit: 100 }) : Promise.resolve({ members: [], pagination: { limit: 0, offset: 0, total: 0 } }),
  ]);
  const schedules = scheduleRows.map((row) => ({
    id: row.id,
    clientId: row.clientId,
    clientName: row.clientName,
    clientAddress: row.clientAddress,
    memberId: row.memberId,
    memberName: row.memberName,
    scheduledDate: row.scheduledDate,
    plannedStartTime: row.plannedStartTime,
    plannedEndTime: row.plannedEndTime,
    purpose: row.purpose,
    status: row.visitStatus,
    checkInAt: row.checkIn?.timestampServer ?? null,
    checkOutAt: row.checkOut?.timestampServer ?? null,
    durationMinutes: row.checkOut?.durationMinutes ?? null,
    validationStatus: row.checkOut?.validationStatus ?? row.checkIn?.validationStatus ?? null,
  }));
  return (
    <main className="page">
      <div className="page-head"><div><p className="eyebrow">Kunjungan client</p><h1 className="page-title">Jadwal kunjungan</h1><p className="page-subtitle">Rencanakan kunjungan lapangan per karyawan dan pantau penyelesaiannya.</p></div><span className="badge badge--yellow"><span className="num">{schedules.filter((row) => row.status === "SCHEDULED").length}</span> terjadwal</span></div>
      <ScheduleManager
        workspaceId={id}
        clients={clients.map((row) => ({ id: row.id, name: row.name }))}
        members={memberResult.members.filter((member) => member.status === "ACTIVE").map((member) => ({ id: member.id, name: member.user.name }))}
        schedules={schedules}
        canManage={canManage}
      />
    </main>
  );
}
