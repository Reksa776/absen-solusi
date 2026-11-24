import { redirect } from "next/navigation";

import { listApprovalCandidates, listApprovalWorkflows } from "@absensi/auth";

import { requirePagePermission } from "@/lib/page-auth";
import { ApprovalWorkflowManager } from "./approval-workflow-manager";

export const dynamic = "force-dynamic";

export default async function ApprovalSettingsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { ctx } = await requirePagePermission("member.read");
  if (!ctx || ctx.tenantId !== id) redirect("/workspaces?error=forbidden");
  const [workflows, candidates] = await Promise.all([
    listApprovalWorkflows({ ctx, workspaceId: id }),
    listApprovalCandidates({ ctx, workspaceId: id }),
  ]);

  return (
    <main className="page page--narrow">
      <div className="page-head">
        <div>
          <p className="eyebrow">Pengaturan persetujuan</p>
          <h1 className="page-title">Alur persetujuan</h1>
          <p className="page-subtitle">
            Pilih satu atau beberapa karyawan per jenjang. Tanpa konfigurasi,
            review memakai fallback HR Admin atau Owner.
          </p>
        </div>
        <span className="badge badge--neutral">
          {workflows.length} alur aktif
        </span>
      </div>
      <ApprovalWorkflowManager
        workspaceId={id}
        workflows={workflows}
        candidates={candidates}
        canManage={ctx.permissions.includes("member.manage")}
      />
    </main>
  );
}
