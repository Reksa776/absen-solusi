import { redirect } from "next/navigation";

import { listWorkPatterns } from "@absensi/auth";

import { requirePagePermission } from "@/lib/page-auth";
import { WorkPatternManager } from "@/components/work-pattern-manager";

export const dynamic = "force-dynamic";

export default async function WorkPatternsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { ctx } = await requirePagePermission("member.read");
  if (!ctx || ctx.tenantId !== id) redirect("/workspaces?error=forbidden");
  const patterns = await listWorkPatterns({ ctx, workspaceId: id });
  const active = patterns.filter((pattern) => pattern.isActive).length;

  return (
    <main className="page">
      <div className="page-head">
        <div>
          <p className="eyebrow">Pola kerja</p>
          <h1 className="page-title">Hari kerja</h1>
          <p className="page-subtitle">
            <span className="num">{active}</span> pola aktif. Atur jam Senin-Minggu, batas awal
            absen, dan toleransi keterlambatan per hari.
          </p>
        </div>
      </div>
      <WorkPatternManager
        workspaceId={id}
        patterns={patterns}
        canManage={ctx.permissions.includes("member.manage")}
      />
    </main>
  );
}
