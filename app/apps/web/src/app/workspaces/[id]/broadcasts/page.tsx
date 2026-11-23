import { redirect } from "next/navigation";

import {
  listDivisions,
  listOffices,
  listWorkspaceBroadcasts,
} from "@absensi/auth";

import { requirePagePermission } from "@/lib/page-auth";
import { BroadcastManager } from "./broadcast-manager";

export const dynamic = "force-dynamic";

export default async function BroadcastsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { ctx } = await requirePagePermission("member.read");
  if (!ctx || ctx.tenantId !== id) redirect("/workspaces?error=forbidden");
  const canManage = ctx.permissions.includes("member.manage");
  const [broadcasts, divisions, offices] = await Promise.all([
    listWorkspaceBroadcasts({ ctx, workspaceId: id }),
    listDivisions({ ctx, workspaceId: id }),
    canManage
      ? listOffices({ ctx, workspaceId: id })
      : Promise.resolve([] as Awaited<ReturnType<typeof listOffices>>),
  ]);

  return (
    <main className="page">
      <div className="page-head">
        <div>
          <p className="eyebrow">Komunikasi internal</p>
          <h1 className="page-title">Broadcast pengumuman</h1>
          <p className="page-subtitle">
            Kirim pengumuman ke semua karyawan atau hanya divisi/lokasi tertentu.
            Prioritas penting tampil lebih dulu di aplikasi mobile.
          </p>
        </div>
        <span className="badge badge--green">
          <span className="num">{broadcasts.filter((row) => row.publishedAt).length}</span>{" "}
          terpublikasi
        </span>
      </div>
      <BroadcastManager
        workspaceId={id}
        broadcasts={broadcasts}
        divisions={divisions
          .filter((division) => division.isActive)
          .map((division) => ({ id: division.id, name: division.name }))}
        offices={offices
          .filter((office) => office.isActive)
          .map((office) => ({ id: office.id, name: office.name }))}
        canManage={canManage}
      />
    </main>
  );
}
