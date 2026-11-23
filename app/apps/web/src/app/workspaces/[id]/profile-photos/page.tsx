import { redirect } from "next/navigation";

import { listProfilePhotos } from "@absensi/auth";

import { requirePagePermission } from "@/lib/page-auth";
import { ProfilePhotoReview } from "./profile-photo-review";

export const dynamic = "force-dynamic";

export default async function ProfilePhotosPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { ctx } = await requirePagePermission("correction.review");
  if (!ctx || ctx.tenantId !== id) redirect("/workspaces?error=forbidden");
  const [pending, approved, rejected] = await Promise.all([
    listProfilePhotos({ ctx, workspaceId: id, status: "PENDING" }),
    listProfilePhotos({ ctx, workspaceId: id, status: "APPROVED" }),
    listProfilePhotos({ ctx, workspaceId: id, status: "REJECTED" }),
  ]);

  return (
    <main className="page">
      <div className="page-head">
        <div>
          <p className="eyebrow">Baseline biometrik</p>
          <h1 className="page-title">Persetujuan foto profil</h1>
          <p className="page-subtitle">
            <span className="num">{pending.length}</span> menunggu ·{" "}
            <span className="num">{approved.length}</span> disetujui ·{" "}
            <span className="num">{rejected.length}</span> ditolak. Foto dipakai
            sebagai baseline verifikasi karyawan.
          </p>
        </div>
      </div>
      <ProfilePhotoReview
        workspaceId={id}
        pending={pending}
        reviewed={[...approved, ...rejected]}
      />
    </main>
  );
}
