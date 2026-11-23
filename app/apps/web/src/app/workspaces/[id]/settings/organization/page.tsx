import { redirect } from "next/navigation";

import { listDivisions, listPositions } from "@absensi/auth";

import { requirePagePermission } from "@/lib/page-auth";
import { OrganizationManager } from "./organization-manager";

export const dynamic = "force-dynamic";

export default async function OrganizationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { ctx } = await requirePagePermission("member.read");
  if (!ctx || ctx.tenantId !== id) redirect("/workspaces?error=forbidden");

  const [divisions, positions] = await Promise.all([
    listDivisions({ ctx, workspaceId: id }),
    listPositions({ ctx, workspaceId: id }),
  ]);
  const activeDivisions = divisions.filter((division) => division.isActive).length;
  const activePositions = positions.filter((position) => position.isActive).length;

  return (
    <main className="page">
      <div className="page-head">
        <div>
          <p className="eyebrow">Struktur organisasi</p>
          <h1 className="page-title">Divisi &amp; jabatan</h1>
          <p className="page-subtitle">
            <span className="num">{activeDivisions}</span> divisi aktif ·{" "}
            <span className="num">{activePositions}</span> jabatan aktif · dipakai untuk
            penempatan karyawan dan filter laporan.
          </p>
        </div>
      </div>
      <OrganizationManager
        workspaceId={id}
        divisions={divisions}
        positions={positions}
        canManage={ctx.permissions.includes("member.manage")}
      />
    </main>
  );
}
