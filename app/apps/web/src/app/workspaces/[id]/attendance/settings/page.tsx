import { redirect } from "next/navigation";

import { getAttendanceSetting } from "@absensi/auth";

import { requirePagePermission } from "@/lib/page-auth";
import { AttendanceSettingsForm } from "@/components/attendance-forms";

export const dynamic = "force-dynamic";

export default async function AttendanceSettingsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { ctx } = await requirePagePermission("attendance.read");
  if (!ctx || ctx.tenantId !== id) redirect("/workspaces?error=forbidden");
  const setting = await getAttendanceSetting({ ctx, workspaceId: id });

  return (
    <main className="page page--narrow">
      <div className="page-head">
        <div>
          <p className="eyebrow">Kebijakan presensi</p>
          <h1 className="page-title">Pengaturan kehadiran</h1>
          <p className="page-subtitle">
            Toleransi, jendela absen, selfie, dan validasi radius GPS berlaku untuk seluruh
            workspace.
          </p>
        </div>
      </div>
      <AttendanceSettingsForm
        workspaceId={id}
        setting={setting}
        canManage={ctx.permissions.includes("member.manage")}
      />
    </main>
  );
}
