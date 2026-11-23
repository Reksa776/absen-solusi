import { redirect } from "next/navigation";
import { listClients } from "@absensi/auth";
import { requirePagePermission } from "@/lib/page-auth";
import { ClientVisitMap } from "@/components/phase-c-forms";

export const dynamic = "force-dynamic";

export default async function ClientVisitMapPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { ctx } = await requirePagePermission("attendance.read");
  if (!ctx || ctx.tenantId !== id) redirect("/workspaces?error=forbidden");
  const clients = await listClients({ ctx, workspaceId: id });
  return (
    <main className="page">
      <div className="page-head"><div><p className="eyebrow">Kunjungan client</p><h1 className="page-title">Virtualisasi kunjungan</h1><p className="page-subtitle">Sebaran koordinat client dan radius geofence untuk perencanaan rute.</p></div><a className="btn btn--secondary" href={`/workspaces/${id}/clients`}>Kelola client</a></div>
      <ClientVisitMap clients={clients} />
    </main>
  );
}
