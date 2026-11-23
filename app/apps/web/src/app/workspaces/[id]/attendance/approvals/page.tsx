import Link from "next/link";
import { redirect } from "next/navigation";

import { listAttendanceApprovals } from "@absensi/auth";

import { requirePagePermission } from "@/lib/page-auth";
import { AttendanceApprovalQueue } from "@/components/attendance-forms";

export const dynamic = "force-dynamic";

export default async function AttendanceApprovalsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { ctx } = await requirePagePermission("correction.review");
  if (!ctx || ctx.tenantId !== id) redirect("/workspaces?error=forbidden");
  const rows = await listAttendanceApprovals({ ctx, workspaceId: id });

  return (
    <main className="page">
      <div className="page-head">
        <div>
          <p className="eyebrow">Persetujuan presensi</p>
          <h1 className="page-title">Antrean persetujuan presensi</h1>
          <p className="page-subtitle">
            Presensi di luar radius, dinas luar kota, atau pengecualian lain yang perlu validasi
            atasan. <span className="num">{rows.length}</span> menunggu.
          </p>
        </div>
        <Link href={`/workspaces/${id}/attendance-review`} className="btn btn--secondary">
          Review luar kota
        </Link>
      </div>
      <AttendanceApprovalQueue workspaceId={id} rows={rows} />
    </main>
  );
}
