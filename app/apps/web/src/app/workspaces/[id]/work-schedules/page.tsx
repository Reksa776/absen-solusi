import { redirect } from "next/navigation";

import {
  listWorkPatternAssignments,
  listWorkPatterns,
  listWorkspaceMembers,
} from "@absensi/auth";

import { requirePagePermission } from "@/lib/page-auth";
import { WorkScheduleManager } from "@/components/work-schedule-manager";

export const dynamic = "force-dynamic";

export default async function WorkSchedulesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { ctx } = await requirePagePermission("member.read");
  if (!ctx || ctx.tenantId !== id) redirect("/workspaces?error=forbidden");
  const [patterns, assignments, members] = await Promise.all([
    listWorkPatterns({ ctx, workspaceId: id }),
    listWorkPatternAssignments({ ctx, workspaceId: id }),
    listWorkspaceMembers({ ctx, workspaceId: id, limit: 100 }),
  ]);

  return (
    <main className="page">
      <div className="page-head">
        <div>
          <p className="eyebrow">Kelola karyawan</p>
          <h1 className="page-title">Jadwal hari kerja</h1>
          <p className="page-subtitle">
            Tugaskan pola kerja aktif ke karyawan. Gunakan tombol{" "}
            <strong>Tambah Pola Kerja</strong> untuk membuat templat baru tanpa meninggalkan halaman.
          </p>
        </div>
        <span className="badge badge--green">{assignments.length} penugasan</span>
      </div>
      <WorkScheduleManager
        workspaceId={id}
        patterns={patterns}
        assignments={assignments}
        members={members.members
          .filter((member) => member.status === "ACTIVE")
          .map((member) => ({
            id: member.id,
            name: member.user.name,
            divisionName: member.divisionName,
          }))}
        canManage={ctx.permissions.includes("member.manage")}
      />
    </main>
  );
}
