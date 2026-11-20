import Link from "next/link";
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
        <Link href={`/workspaces/${id}/dashboard`}>← Dashboard</Link>
      </p>
      <h1 style={{ fontSize: "1.5rem" }}>Pengaturan kantor</h1>
      <p style={{ color: "#555" }}>
        Koordinat, radius, timezone, dan jam kerja dipakai server untuk geofence
        serta perhitungan keterlambatan. Hanya satu kantor yang dapat aktif.
      </p>
      <OfficeManager workspaceId={id} offices={offices} />
    </main>
  );
}
