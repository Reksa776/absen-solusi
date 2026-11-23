import { redirect } from "next/navigation";

import { listWorkspaceLeaveRequests } from "@absensi/auth";

import { requirePagePermission } from "@/lib/page-auth";
import { LeaveReview } from "./leave-review";

export const dynamic = "force-dynamic";

const FILTERS = ["PENDING", "APPROVED", "REJECTED", "ALL"] as const;

export default async function LeavePage({
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
  const rows = await listWorkspaceLeaveRequests({
    ctx,
    workspaceId: id,
    status: status === "ALL" ? undefined : status,
  });

  return (
    <main className="page">
      <div className="page-head">
        <div>
          <p className="eyebrow">Izin & cuti</p>
          <h1 className="page-title">Permohonan cuti</h1>
          <p className="page-subtitle">
            Persetujuan berjenjang mengikuti alur <strong>LEAVE</strong>. Saldo cuti
            tahunan dipotong hanya setelah approval terakhir.
          </p>
        </div>
        <span className="badge badge--neutral">
          <span className="num">{rows.length}</span> data
        </span>
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
        <a
          className="btn btn--secondary"
          href={`/workspaces/${id}/leave/report`}
          style={{ marginLeft: "auto" }}
        >
          Laporan cuti
        </a>
      </form>

      <LeaveReview rows={rows} canReview={ctx.permissions.includes("correction.review")} />
    </main>
  );
}
