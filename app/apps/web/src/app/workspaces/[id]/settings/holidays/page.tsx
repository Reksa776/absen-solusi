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
    <main className="page page--narrow">
      <div className="page-head">
        <div>
          <p className="eyebrow">Kalender kerja</p>
          <h1 className="page-title">Hari libur workspace</h1>
          <p className="page-subtitle">
            Tanggal libur tidak dihitung sebagai alpha pada rekap bulanan.
          </p>
        </div>
        <span className="badge badge--yellow">{holidays.length} tanggal</span>
      </div>
      <HolidayManager workspaceId={id} holidays={holidays} />
    </main>
  );
}
