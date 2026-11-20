import { redirect } from "next/navigation";

import { listOffices, listShifts, listWorkspaceMembers } from "@absensi/auth";

import { requirePagePermission } from "@/lib/page-auth";
import { MemberAdmin } from "./member-admin";

export const dynamic = "force-dynamic";

export default async function MembersPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { ctx } = await requirePagePermission("member.read");
  if (!ctx || ctx.tenantId !== id) redirect("/workspaces?error=forbidden");
  const result = await listWorkspaceMembers({ ctx, workspaceId: id });
  const canAssignOffice = ctx.permissions.includes("office.manage");
  const offices = canAssignOffice
    ? (await listOffices({ ctx, workspaceId: id })).map((office) => ({
        id: office.id,
        name: office.name,
      }))
    : [];
  const shifts = canAssignOffice
    ? (await listShifts({ ctx, workspaceId: id }))
        .filter((shift) => shift.isActive)
        .map((shift) => ({
          id: shift.id,
          name: `${shift.name} (${shift.startTime}–${shift.endTime})`,
        }))
    : [];

  return (
    <main className="page">
      <div className="page-head">
        <div>
          <p className="eyebrow">People operations</p>
          <h1 className="page-title">Karyawan</h1>
          <p className="page-subtitle">
            {result.pagination.total} karyawan · role Anda:{" "}
            {ctx.roleKeys.join(", ") || "—"}
          </p>
        </div>
      </div>
      <MemberAdmin
        workspaceId={id}
        currentMemberId={ctx.memberId}
        members={result.members}
        offices={offices}
        shifts={shifts}
        canInvite={ctx.permissions.includes("member.invite")}
        canManageRoles={ctx.permissions.includes("role.manage")}
        canAssignOffice={canAssignOffice}
        canResetPassword={ctx.permissions.includes("member.manage")}
      />
    </main>
  );
}
