import { redirect } from "next/navigation";

import { listWorkspaceWorkPermits } from "@absensi/auth";

import { requirePagePermission } from "@/lib/page-auth";
import { PermitReview } from "./permit-review";

export const dynamic = "force-dynamic";

const FILTERS = ["PENDING", "APPROVED", "REJECTED", "ALL"] as const;

export default async function PermitsPage({
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
  const requested = (query.status ?? "ALL").toUpperCase();
  const status = (FILTERS as readonly string[]).includes(requested) ? requested : "ALL";
  const rows = await listWorkspaceWorkPermits({
    ctx,
    workspaceId: id,
    status: status === "ALL" ? undefined : status,
  });

  return (
    <main className="page">
      <div className="page-head">
        <div>
          <p className="eyebrow">Izin & cuti</p>
          <h1 className="page-title">Izin kerja</h1>
          <p className="page-subtitle">
            Sakit, izin pribadi, pulang cepat, datang terlambat, dan izin lainnya.
            Persetujuan mengikuti alur <strong>PERMIT</strong> bila dikonfigurasi.
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
      </form>

      <PermitReview rows={rows} canReview={ctx.permissions.includes("correction.review")} />
    </main>
  );
}
