import { redirect } from "next/navigation";

import { listWorkspaceMembers, listWorkspaceWarningLetters } from "@absensi/auth";

import { requirePagePermission } from "@/lib/page-auth";
import { WarningLetterManager } from "./warning-letter-manager";

export const dynamic = "force-dynamic";

export default async function WarningLettersPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { ctx } = await requirePagePermission("member.read");
  if (!ctx || ctx.tenantId !== id) redirect("/workspaces?error=forbidden");
  const canManage = ctx.permissions.includes("member.manage");
  const [letters, memberResult] = await Promise.all([
    listWorkspaceWarningLetters({ ctx, workspaceId: id, status: "ALL" }),
    canManage
      ? listWorkspaceMembers({ ctx, workspaceId: id, limit: 100 })
      : Promise.resolve({ members: [], pagination: { limit: 0, offset: 0, total: 0 } }),
  ]);
  const members = memberResult.members
    .filter((member) => member.status === "ACTIVE")
    .map((member) => ({
      id: member.id,
      name: member.user.name,
      email: member.user.email,
      divisionName: member.divisionName,
    }));

  return (
    <main className="page">
      <div className="page-head">
        <div>
          <p className="eyebrow">Kelola karyawan</p>
          <h1 className="page-title">Surat peringatan</h1>
          <p className="page-subtitle">
            Terbitkan SP1–SP3 dengan nomor unik, pantau masa berlaku, dan pastikan
            karyawan mengonfirmasi surat sudah dibaca.
          </p>
        </div>
        <span className="badge badge--yellow">
          <span className="num">{letters.filter((row) => row.isActive).length}</span> aktif
        </span>
      </div>
      <WarningLetterManager
        workspaceId={id}
        letters={letters}
        members={members}
        canManage={canManage}
      />
    </main>
  );
}
