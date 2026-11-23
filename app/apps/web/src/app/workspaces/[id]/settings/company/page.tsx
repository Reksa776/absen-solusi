import { redirect } from "next/navigation";
import { getCompanyProfile } from "@absensi/auth";
import { requirePagePermission } from "@/lib/page-auth";
import { CompanyProfileForm } from "@/components/phase-c-forms";

export const dynamic = "force-dynamic";

export default async function CompanySettingsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { ctx } = await requirePagePermission("workspace.read");
  if (!ctx || ctx.tenantId !== id) redirect("/workspaces?error=forbidden");
  const profile = await getCompanyProfile({ ctx, workspaceId: id });
  const canManage = ctx.permissions.includes("workspace.manage");
  return (
    <main className="page page--narrow">
      <div className="page-head"><div><p className="eyebrow">Pengaturan</p><h1 className="page-title">Perusahaan</h1><p className="page-subtitle">Identitas resmi, NPWP, kontak, dan jam operasional.</p></div><span className="badge badge--neutral">{profile.updatedAt ? "Tersimpan" : "Belum diatur"}</span></div>
      {canManage ? <CompanyProfileForm workspaceId={id} initial={profile} /> : <div className="card card-pad"><p className="section-title">{profile.legalName}</p><p className="section-note">{profile.address ?? "Alamat belum diisi"} · {profile.contactEmail ?? "Email belum diisi"} · {profile.operatingHours ?? "Jam operasional belum diisi"}</p></div>}
    </main>
  );
}
