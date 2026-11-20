import Link from "next/link";
import { redirect } from "next/navigation";

import { listOffices, listWorkspaceMembers } from "@absensi/auth";

import { requirePagePermission } from "@/lib/page-auth";
import { MemberAdmin } from "./member-admin";

export const dynamic = "force-dynamic";

export default async function MembersPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { ctx, session } = await requirePagePermission("member.read");
  if (!ctx || ctx.tenantId !== id) redirect("/workspaces?error=forbidden");
  const result = await listWorkspaceMembers({ ctx, workspaceId: id });
  const canAssignOffice = ctx.permissions.includes("office.manage");
  const offices = canAssignOffice
    ? (await listOffices({ ctx, workspaceId: id })).map((office) => ({
        id: office.id,
        name: office.name,
      }))
    : [];

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
        <Link href="/workspaces">← Workspace</Link>
      </p>
      <h1 style={{ fontSize: "1.5rem" }}>Member workspace</h1>
      <p style={{ color: "#555" }}>
        {result.pagination.total} member · role Anda: {ctx.roleKeys.join(", ") || "—"}
      </p>
      <MemberAdmin
        workspaceId={id}
        currentMemberId={session.activeTenantId ? ctx.memberId : null}
        members={result.members}
        offices={offices}
        canInvite={ctx.permissions.includes("member.invite")}
        canManageRoles={ctx.permissions.includes("role.manage")}
        canAssignOffice={canAssignOffice}
      />
    </main>
  );
}
