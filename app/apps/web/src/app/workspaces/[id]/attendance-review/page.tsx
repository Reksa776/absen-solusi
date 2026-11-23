import { redirect } from "next/navigation";

import { listOutOfTownAttendance } from "@absensi/auth";

import { requirePagePermission } from "@/lib/page-auth";
import { OutOfTownReview } from "./out-of-town-review";

export const dynamic = "force-dynamic";

export default async function AttendanceReviewPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { ctx } = await requirePagePermission("correction.review");
  if (!ctx || ctx.tenantId !== id) redirect("/workspaces?error=forbidden");
  const [pending, all] = await Promise.all([
    listOutOfTownAttendance({ ctx, workspaceId: id, status: "PENDING" }),
    listOutOfTownAttendance({ ctx, workspaceId: id, status: "ALL" }),
  ]);

  return (
    <main className="page">
      <div className="page-head">
        <div>
          <p className="eyebrow">Presensi khusus</p>
          <h1 className="page-title">Review kehadiran luar kota</h1>
          <p className="page-subtitle">
            Presensi dinas luar kota dicatat di luar geofence dan menunggu
            persetujuan. <span className="num">{pending.length}</span> menunggu dari{" "}
            <span className="num">{all.length}</span> total.
          </p>
        </div>
        <span className="badge badge--yellow">{pending.length} pending</span>
      </div>
      <OutOfTownReview workspaceId={id} pending={pending} all={all} />
    </main>
  );
}
