import { redirect } from "next/navigation";

import {
  listShiftAssignments,
  listShifts,
  listWorkspaceMembers,
} from "@absensi/auth";

import { requirePagePermission } from "@/lib/page-auth";
import { ShiftManager } from "./shift-manager";

export const dynamic = "force-dynamic";

export default async function ShiftsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { ctx } = await requirePagePermission("office.manage");
  if (!ctx || ctx.tenantId !== id) redirect("/workspaces?error=forbidden");

  const [shifts, assignments, members] = await Promise.all([
    listShifts({ ctx, workspaceId: id }),
    listShiftAssignments({ ctx, workspaceId: id }),
    listWorkspaceMembers({ ctx, workspaceId: id, limit: 100 }),
  ]);

  return (
    <main className="page">
      <div className="page-head">
        <div>
          <p className="eyebrow">Jadwal</p>
          <h1 className="page-title">Shift kerja</h1>
          <p className="page-subtitle">
            Shift menentukan jam masuk, toleransi keterlambatan, dan pengingat worker.
            Tanpa penugasan, laporan memakai jam kantor.
          </p>
        </div>
        <span className="badge badge--yellow">{shifts.filter((shift) => shift.isActive).length} shift aktif</span>
      </div>
      <ShiftManager
        workspaceId={id}
        shifts={shifts}
        assignments={assignments}
        members={members.members
          .filter((member) => member.status === "ACTIVE")
          .map((member) => ({ id: member.id, name: member.user.name }))}
      />
    </main>
  );
}
