import { redirect } from "next/navigation";

import { listDivisions, listPositions } from "@absensi/auth";

import { requirePagePermission } from "@/lib/page-auth";
import { OrganizationManager } from "../settings/organization/organization-manager";

export const dynamic = "force-dynamic";

export default async function PositionsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { ctx } = await requirePagePermission("member.read");
  if (!ctx || ctx.tenantId !== id) redirect("/workspaces?error=forbidden");
  const [divisions, positions] = await Promise.all([
    listDivisions({ ctx, workspaceId: id }),
    listPositions({ ctx, workspaceId: id }),
  ]);
  const active = positions.filter((position) => position.isActive).length;

  return (
    <main className="page">
      <div className="page-head">
        <div>
          <p className="eyebrow">Struktur organisasi</p>
          <h1 className="page-title">Jabatan</h1>
          <p className="page-subtitle">
            <span className="num">{active}</span> jabatan aktif dari{" "}
            <span className="num">{positions.length}</span> jabatan terdaftar.
          </p>
        </div>
      </div>
      <OrganizationManager
        workspaceId={id}
        divisions={divisions}
        positions={positions}
        canManage={ctx.permissions.includes("member.manage")}
        mode="positions"
      />
    </main>
  );
}
