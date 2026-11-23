import { redirect } from "next/navigation";

import { listWorkspaceWorkPermits } from "@absensi/auth";

import { requirePagePermission } from "@/lib/page-auth";
import { PermitReview } from "../permit-review";

export const dynamic = "force-dynamic";

export default async function PermitReviewPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { ctx } = await requirePagePermission("correction.review");
  if (!ctx || ctx.tenantId !== id) redirect("/workspaces?error=forbidden");
  const rows = await listWorkspaceWorkPermits({
    ctx,
    workspaceId: id,
    status: "PENDING",
  });

  return (
    <main className="page">
      <div className="page-head">
        <div>
          <p className="eyebrow">Approval berjenjang</p>
          <h1 className="page-title">Review izin kerja</h1>
          <p className="page-subtitle">
            Hanya pengajuan yang menunggu. Setiap level harus disetujui role yang
            ditentukan pada alur PERMIT.
          </p>
        </div>
        <span className={rows.length > 0 ? "badge badge--yellow" : "badge badge--green"}>
          <span className="num">{rows.length}</span> menunggu
        </span>
      </div>
      <PermitReview
        rows={rows}
        canReview={ctx.permissions.includes("correction.review")}
        compact
      />
    </main>
  );
}
