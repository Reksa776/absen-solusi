import Link from "next/link";
import { redirect } from "next/navigation";

import { listWorkspaceCorrections } from "@absensi/auth";

import { requirePagePermission } from "@/lib/page-auth";
import { CorrectionQueue } from "./correction-queue";

export const dynamic = "force-dynamic";

const STATUS_FILTERS = ["PENDING", "APPROVED", "REJECTED", "ALL"] as const;

export default async function CorrectionsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ status?: string }>;
}) {
  const { id } = await params;
  const query = await searchParams;
  const { ctx } = await requirePagePermission("correction.read");
  if (!ctx || ctx.tenantId !== id) redirect("/workspaces?error=forbidden");

  const requested = (query.status ?? "PENDING").toUpperCase();
  const status = (STATUS_FILTERS as readonly string[]).includes(requested)
    ? requested
    : "PENDING";
  const result = await listWorkspaceCorrections({
    ctx,
    workspaceId: id,
    status: status === "ALL" ? undefined : status,
  });

  return (
    <main className="page">
      <div className="page-head">
        <div>
          <p className="eyebrow">Kontrol kehadiran</p>
          <h1 className="page-title">Antrian revisi kehadiran</h1>
          <p className="page-subtitle">
            {result.pagination.total} revisi · bukti dan riwayat tercatat pada audit log
          </p>
        </div>
        {ctx.permissions.includes("correction.review") ? (
          <Link href={`/workspaces/${id}/corrections/bulk`} className="btn btn--secondary">
            Koreksi massal
          </Link>
        ) : null}
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

      <CorrectionQueue
        workspaceId={id}
        corrections={result.corrections}
        canReview={ctx.permissions.includes("correction.review")}
      />
    </main>
  );
}
