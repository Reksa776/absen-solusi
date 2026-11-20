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
    <main
      style={{
        fontFamily: "system-ui, sans-serif",
        maxWidth: "72rem",
        margin: "0 auto",
        padding: "3rem 1.5rem",
        lineHeight: 1.6,
      }}
    >
      <p>
        <Link href="/workspaces">← Workspace</Link>
      </p>
      <h1 style={{ fontSize: "1.5rem" }}>Antrian revisi kehadiran</h1>
      {ctx.permissions.includes("correction.review") ? (
        <p>
          <Link href={`/workspaces/${id}/corrections/bulk`}>Koreksi massal</Link>
        </p>
      ) : null}
      <form method="get" style={{ display: "flex", gap: "0.5rem", marginBottom: "1rem" }}>
        <select name="status" defaultValue={status} style={{ padding: "0.5rem" }}>
          <option value="PENDING">Menunggu</option>
          <option value="APPROVED">Disetujui</option>
          <option value="REJECTED">Ditolak</option>
          <option value="ALL">Semua</option>
        </select>
        <button type="submit" style={{ padding: "0.6rem" }}>
          Filter
        </button>
      </form>
      <p style={{ color: "#555" }}>{result.pagination.total} revisi</p>
      <CorrectionQueue
        workspaceId={id}
        corrections={result.corrections}
        canReview={ctx.permissions.includes("correction.review")}
      />
    </main>
  );
}
