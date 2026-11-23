import { redirect } from "next/navigation";
import { listWorkspaceMembers } from "@absensi/auth";
import { requirePagePermission } from "@/lib/page-auth";
import { AdminRoleManager } from "@/components/phase-c-forms";

export const dynamic = "force-dynamic";

export default async function AdminAccountsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { ctx } = await requirePagePermission("member.read");
  if (!ctx || ctx.tenantId !== id) redirect("/workspaces?error=forbidden");
  const result = await listWorkspaceMembers({ ctx, workspaceId: id, limit: 100 });
  const members = result.members.filter((member) => member.status === "ACTIVE").map((member) => ({ id: member.id, name: member.user.name, email: member.user.email, roleKeys: member.roleKeys, status: member.status }));
  return (
    <main className="page">
      <div className="page-head"><div><p className="eyebrow">Pengaturan</p><h1 className="page-title">Akun admin</h1><p className="page-subtitle">Manajemen role admin workspace. Perubahan dicatat pada audit log.</p></div><a className="btn btn--secondary" href={`/workspaces/${id}/members`}>Kelola karyawan</a></div>
      <AdminRoleManager workspaceId={id} members={members} currentMemberId={ctx.memberId} />
    </main>
  );
}
