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
    <main
      style={{
        fontFamily: "system-ui, sans-serif",
        maxWidth: "64rem",
        margin: "0 auto",
        padding: "3rem 1.5rem",
        lineHeight: 1.6,
      }}
    >
      <p>
        <Link href={`/workspaces/${id}/corrections`}>← Antrian revisi</Link>
      </p>
      <h1 style={{ fontSize: "1.5rem" }}>Koreksi massal</h1>
      <p style={{ color: "#555" }}>
        Pilih beberapa karyawan, lalu tetapkan jam check-in/check-out yang sama.
        Seluruh perubahan disimpan atomik dan setiap karyawan menerima notifikasi.
      </p>
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
