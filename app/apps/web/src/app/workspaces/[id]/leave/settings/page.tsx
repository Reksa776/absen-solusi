import { redirect } from "next/navigation";

import { getLeavePolicy } from "@absensi/auth";

import { requirePagePermission } from "@/lib/page-auth";
import { LeaveSettingsForm } from "./leave-settings-form";

export const dynamic = "force-dynamic";

export default async function LeaveSettingsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { ctx } = await requirePagePermission("correction.review");
  if (!ctx || ctx.tenantId !== id) redirect("/workspaces?error=forbidden");
  const policy = await getLeavePolicy({ ctx, workspaceId: id });

  return (
    <main className="page page--narrow">
      <div className="page-head">
        <div>
          <p className="eyebrow">Pengaturan cuti</p>
          <h1 className="page-title">Kuota & saldo cuti</h1>
          <p className="page-subtitle">
            Jatah tahunan dipakai sebagai default saat cuti tahunan disetujui.
          </p>
        </div>
        <span className="badge badge--green">
          <span className="num">{policy.annualQuotaDays}</span> hari
        </span>
      </div>
      <LeaveSettingsForm
        workspaceId={id}
        initialQuota={policy.annualQuotaDays}
        year={new Date().getUTCFullYear()}
      />
      <div className="card" style={{ marginTop: "1rem", padding: "1rem" }}>
        <p className="section-title" style={{ marginTop: 0 }}>
          Alur persetujuan cuti
        </p>
        <p className="section-note">
          Atur urutan approver pada <strong>Pengaturan → Alur persetujuan → Cuti</strong>.
          Bila belum dikonfigurasi, HR Admin/Owner dapat menyetujui langsung.
        </p>
        <a className="btn btn--secondary btn--sm" href={`/workspaces/${id}/settings/approvals`}>
          Buka alur persetujuan
        </a>
      </div>
    </main>
  );
}
