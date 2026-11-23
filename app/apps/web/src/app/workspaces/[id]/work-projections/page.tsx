import { redirect } from "next/navigation";
import { listWorkspaceWorkProjections } from "@absensi/auth";
import { requirePagePermission } from "@/lib/page-auth";
import { ProjectionReview } from "@/components/phase-c-forms";

export const dynamic = "force-dynamic";

export default async function WorkProjectionsPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ status?: string }> }) {
  const { id } = await params;
  const query = await searchParams;
  const { ctx } = await requirePagePermission("attendance.read");
  if (!ctx || ctx.tenantId !== id) redirect("/workspaces?error=forbidden");
  const projections = await listWorkspaceWorkProjections({ ctx, workspaceId: id, status: query.status });
  const canManage = ctx.permissions.includes("member.manage");
  return (
    <main className="page">
      <div className="page-head"><div><p className="eyebrow">Pekerjaan</p><h1 className="page-title">Proyeksi pekerjaan</h1><p className="page-subtitle">Target harian dan mingguan karyawan, progres 0–100%, kendala, dan review atasan.</p></div><span className="badge badge--green"><span className="num">{projections.filter((row) => row.status === "COMPLETED").length}</span> selesai</span></div>
      <div className="toolbar"><a className="btn btn--secondary btn--sm" href={`/workspaces/${id}/work-projections`}>Semua</a><a className="btn btn--secondary btn--sm" href={`/workspaces/${id}/work-projections?status=IN_PROGRESS`}>Berjalan</a><a className="btn btn--secondary btn--sm" href={`/workspaces/${id}/work-projections?status=BLOCKED`}>Kendala</a><a className="btn btn--secondary btn--sm" href={`/workspaces/${id}/work-projections?status=COMPLETED`}>Selesai</a></div>
      <ProjectionReview workspaceId={id} projections={projections} canManage={canManage} />
    </main>
  );
}
