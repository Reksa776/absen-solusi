import { redirect } from "next/navigation";

import {
  listDivisions,
  listOffices,
  listPositions,
  listWorkspaceMembers,
} from "@absensi/auth";

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
  const canManageOrganization = ctx.permissions.includes("member.manage");
  const offices = canAssignOffice
    ? (await listOffices({ ctx, workspaceId: id })).map((office) => ({
        id: office.id,
        name: office.name,
      }))
    : [];
  const divisions = canManageOrganization
    ? (await listDivisions({ ctx, workspaceId: id }))
        .filter((division) => division.isActive)
        .map((division) => ({ id: division.id, name: division.name }))
    : [];
  const positions = canManageOrganization
    ? (await listPositions({ ctx, workspaceId: id }))
        .filter((position) => position.isActive)
        .map((position) => ({
          id: position.id,
          name: position.name,
          divisionName: position.divisionName,
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
        divisions={divisions}
        positions={positions}
        canInvite={ctx.permissions.includes("member.invite")}
        canManageRoles={ctx.permissions.includes("role.manage")}
        canAssignOffice={canAssignOffice}
        canManageOrganization={canManageOrganization}
        canResetPassword={ctx.permissions.includes("member.manage")}
      />
    </main>
  );
}
