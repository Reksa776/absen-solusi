import Link from "next/link";
import { redirect } from "next/navigation";

import { listHolidays } from "@absensi/auth";

import { requirePagePermission } from "@/lib/page-auth";
import { HolidayManager } from "./holiday-manager";

export const dynamic = "force-dynamic";

export default async function HolidaysPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { ctx } = await requirePagePermission("workspace.manage");
  if (!ctx || ctx.tenantId !== id) redirect("/workspaces?error=forbidden");
  const holidays = await listHolidays({ ctx, workspaceId: id });

  return (
    <main
      style={{
        fontFamily: "system-ui, sans-serif",
        maxWidth: "56rem",
        margin: "0 auto",
        padding: "3rem 1.5rem",
        lineHeight: 1.6,
      }}
    >
      <p>
        <Link href={`/workspaces/${id}/dashboard`}>← Dashboard</Link>
      </p>
      <h1 style={{ fontSize: "1.5rem" }}>Hari libur workspace</h1>
      <p style={{ color: "#555" }}>
        Tanggal libur tidak dihitung sebagai alpha pada rekap bulanan.
      </p>
      <HolidayManager workspaceId={id} holidays={holidays} />
    </main>
  );
}
