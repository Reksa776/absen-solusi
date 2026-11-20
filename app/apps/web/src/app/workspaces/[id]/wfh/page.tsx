import { redirect } from "next/navigation";

import { listWorkspaceWfh } from "@absensi/auth";

import { RequestReview } from "@/components/request-review";
import { requirePagePermission } from "@/lib/page-auth";

export const dynamic = "force-dynamic";

const FILTERS = ["PENDING", "APPROVED", "REJECTED", "ALL"] as const;

export default async function WfhPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ status?: string }>;
}) {
  const { id } = await params;
  const query = await searchParams;
  const { ctx } = await requirePagePermission("correction.review");
  if (!ctx || ctx.tenantId !== id) redirect("/workspaces?error=forbidden");
  const requested = (query.status ?? "PENDING").toUpperCase();
  const status = (FILTERS as readonly string[]).includes(requested) ? requested : "PENDING";
  const rows = await listWorkspaceWfh({
    ctx,
    workspaceId: id,
    status: status === "ALL" ? undefined : status,
  });

  return (
    <main className="page">
      <div className="page-head">
        <div>
          <p className="eyebrow">Approval</p>
          <h1 className="page-title">Antrian approval WFH</h1>
          <p className="page-subtitle">{rows.length} pengajuan pada filter ini</p>
        </div>
      </div>

      <form method="get" className="toolbar">
        <label className="field" style={{ minWidth: "11rem" }}>
          Status
          <select name="status" defaultValue={status}>
            <option value="PENDING">Menunggu</option>
            <option value="APPROVED">Disetujui</option>
            <option value="REJECTED">Ditolak</option>
            <option value="ALL">Semua</option>
          </select>
        </label>
        <button type="submit" className="btn btn--primary">
          Filter
        </button>
      </form>

      <RequestReview kind="wfh" rows={rows} canReview={ctx.permissions.includes("correction.review")} />
    </main>
  );
}
