import { redirect } from "next/navigation";

import { listOvertimeSchedules, listWorkspaceMembers } from "@absensi/auth";

import { requirePagePermission } from "@/lib/page-auth";
import { OvertimeScheduleManager } from "@/components/overtime-forms";

export const dynamic = "force-dynamic";

export default async function OvertimeSchedulePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { ctx } = await requirePagePermission("correction.review");
  if (!ctx || ctx.tenantId !== id) redirect("/workspaces?error=forbidden");
  const [schedules, members] = await Promise.all([
    listOvertimeSchedules({ ctx, workspaceId: id }),
    listWorkspaceMembers({ ctx, workspaceId: id, limit: 100 }),
  ]);
  const planned = schedules.filter((schedule) => schedule.status === "PLANNED").length;

  return (
    <main className="page">
      <div className="page-head">
        <div>
          <p className="eyebrow">Lembur</p>
          <h1 className="page-title">Jadwal lembur</h1>
          <p className="page-subtitle">
            <span className="num">{planned}</span> jadwal aktif dari{" "}
            <span className="num">{schedules.length}</span> jadwal. Karyawan melihat jadwal ini di
            tab Pengajuan aplikasi mobile.
          </p>
        </div>
      </div>
      <OvertimeScheduleManager
        workspaceId={id}
        members={members.members
          .filter((member) => member.status === "ACTIVE")
          .map((member) => ({
            id: member.id,
            name: member.user.name,
            divisionName: member.divisionName,
          }))}
        schedules={schedules}
      />
    </main>
  );
}
