import Link from "next/link";
import { redirect } from "next/navigation";

import { listWorkspaceMembers } from "@absensi/auth";

import { requirePagePermission } from "@/lib/page-auth";
import { BulkCorrectionForm } from "./bulk-correction-form";

export const dynamic = "force-dynamic";

export default async function BulkCorrectionsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { ctx } = await requirePagePermission("correction.review");
  if (!ctx || ctx.tenantId !== id) redirect("/workspaces?error=forbidden");
  const result = await listWorkspaceMembers({ ctx, workspaceId: id, limit: 100 });

  return (
    <main className="page page--narrow">
      <Link href={`/workspaces/${id}/corrections`} className="back-link">
        ← Antrian revisi
      </Link>
      <div className="page-head">
        <div>
          <p className="eyebrow">Koreksi massal</p>
          <h1 className="page-title">Koreksi massal</h1>
          <p className="page-subtitle">
            Pilih beberapa karyawan, lalu tetapkan jam check-in/check-out yang sama.
            Seluruh perubahan disimpan atomik dan setiap karyawan menerima notifikasi.
          </p>
        </div>
      </div>
      <BulkCorrectionForm
        workspaceId={id}
        members={result.members
          .filter((member) => member.status === "ACTIVE")
          .map((member) => ({
            id: member.id,
            name: member.user.name,
            email: member.user.email,
          }))}
      />
    </main>
  );
}
