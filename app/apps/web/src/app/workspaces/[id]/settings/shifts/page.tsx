import Link from "next/link";
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
    <main
      style={{
        fontFamily: "system-ui, sans-serif",
        maxWidth: "64rem",
        margin: "0 auto",
        padding: "3rem 1.5rem",
        lineHeight: 1.6,
      }}
    >
      <p>
        <Link href={`/workspaces/${id}/dashboard`}>← Dashboard</Link>
      </p>
      <h1 style={{ fontSize: "1.5rem" }}>Shift kerja</h1>
      <p style={{ color: "#555" }}>
        Shift menentukan jam masuk, toleransi keterlambatan, dan pengingat worker.
        Tanpa penugasan, laporan memakai jam kantor.
      </p>
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
