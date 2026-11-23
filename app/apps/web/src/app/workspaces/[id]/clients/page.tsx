import { redirect } from "next/navigation";
import { listClients } from "@absensi/auth";
import { requirePagePermission } from "@/lib/page-auth";
import { ClientManager } from "@/components/phase-c-forms";

export const dynamic = "force-dynamic";

export default async function ClientsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { ctx } = await requirePagePermission("attendance.read");
  if (!ctx || ctx.tenantId !== id) redirect("/workspaces?error=forbidden");
  const clients = await listClients({ ctx, workspaceId: id });
  return (
    <main className="page">
      <div className="page-head"><div><p className="eyebrow">Kunjungan client</p><h1 className="page-title">Master client</h1><p className="page-subtitle">Kelola perusahaan klien, PIC, titik koordinat, dan radius validasi kunjungan.</p></div><span className="badge badge--green"><span className="num">{clients.filter((row) => row.isActive).length}</span> aktif</span></div>
      <ClientManager workspaceId={id} clients={clients} canManage={ctx.permissions.includes("member.manage")} />
    </main>
  );
}
