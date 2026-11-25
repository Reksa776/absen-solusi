import { redirect } from "next/navigation";

import { listWorkspaceWfh } from "@absensi/auth";

import { requirePagePermission } from "@/lib/page-auth";
import { WfhReview } from "./wfh-review";

export const dynamic = "force-dynamic";

export default async function WfhPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { ctx } = await requirePagePermission("correction.review");
  if (!ctx || ctx.tenantId !== id) redirect("/workspaces?error=forbidden");
  const rows = await listWorkspaceWfh({ ctx, workspaceId: id });
  const pending = rows.filter((row) => row.status === "PENDING").length;
  const approved = rows.filter((row) => row.status === "APPROVED").length;
  const rejected = rows.filter((row) => row.status === "REJECTED").length;

  return (
    <main className="page">
      <div className="page-head">
        <div>
          <p className="eyebrow">Kehadiran</p>
          <h1 className="page-title">Pengajuan WFH</h1>
          <p className="page-subtitle">
            Setujui atau tolak pengajuan kerja dari rumah. Keputusan langsung
            mengirim notifikasi ke karyawan.
          </p>
        </div>
      </div>

      <section className="kpi-grid" aria-label="Ringkasan pengajuan WFH">
        <article className="kpi">
          <div className="kpi-label">Menunggu</div>
          <div className="kpi-value">{pending}</div>
          <div className="kpi-bar kpi-bar--yellow" aria-hidden="true">
            <span style={{ width: pending > 0 ? "100%" : "0%" }} />
          </div>
          <div className="kpi-foot">butuh keputusan admin</div>
        </article>
        <article className="kpi">
          <div className="kpi-label">Disetujui</div>
          <div className="kpi-value">{approved}</div>
          <div className="kpi-bar" aria-hidden="true">
            <span style={{ width: approved > 0 ? "100%" : "0%" }} />
          </div>
          <div className="kpi-foot">bebas geofence pada tanggalnya</div>
        </article>
        <article className="kpi">
          <div className="kpi-label">Ditolak</div>
          <div className="kpi-value">{rejected}</div>
          <div className="kpi-bar kpi-bar--red" aria-hidden="true">
            <span style={{ width: rejected > 0 ? "100%" : "0%" }} />
          </div>
          <div className="kpi-foot">karyawan menerima catatan admin</div>
        </article>
      </section>

      <WfhReview
        workspaceId={id}
        rows={rows}
        canReview={ctx.permissions.includes("correction.review")}
      />
    </main>
  );
}
