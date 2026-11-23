import { redirect } from "next/navigation";

import { getOvertimeSetting } from "@absensi/auth";

import { requirePagePermission } from "@/lib/page-auth";
import { OvertimeSettingsForm } from "@/components/overtime-forms";

export const dynamic = "force-dynamic";

export default async function OvertimeSettingsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { ctx } = await requirePagePermission("correction.review");
  if (!ctx || ctx.tenantId !== id) redirect("/workspaces?error=forbidden");
  const setting = await getOvertimeSetting({ ctx, workspaceId: id });

  return (
    <main className="page page--narrow">
      <div className="page-head">
        <div>
          <p className="eyebrow">Aturan lembur</p>
          <h1 className="page-title">Pengaturan lembur</h1>
          <p className="page-subtitle">
            Batas durasi dan pengali tarif dipakai langsung oleh preview serta generate gaji.
          </p>
        </div>
      </div>
      <OvertimeSettingsForm workspaceId={id} setting={setting} />
    </main>
  );
}
