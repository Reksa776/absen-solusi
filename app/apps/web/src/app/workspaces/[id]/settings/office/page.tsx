import { redirect } from "next/navigation";

import { listOffices } from "@absensi/auth";

import { requirePagePermission } from "@/lib/page-auth";
import { OfficeManager } from "./office-manager";

export const dynamic = "force-dynamic";

export default async function OfficeSettingsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { ctx } = await requirePagePermission("office.manage");
  if (!ctx || ctx.tenantId !== id) redirect("/workspaces?error=forbidden");
  const offices = await listOffices({ ctx, workspaceId: id });

  return (
    <main className="page">
      <div className="page-head">
        <div>
          <p className="eyebrow">Geofence</p>
          <h1 className="page-title">Pengaturan kantor</h1>
          <p className="page-subtitle">
            Koordinat, radius, timezone, dan jam kerja dipakai server untuk geofence
            serta perhitungan keterlambatan. Hanya satu kantor yang dapat aktif.
          </p>
        </div>
        <span className="badge badge--neutral">{offices.length} kantor</span>
      </div>
      <OfficeManager workspaceId={id} offices={offices} />
    </main>
  );
}
