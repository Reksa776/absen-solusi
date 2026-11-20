import { redirect } from "next/navigation";

import { apkInfo, readMobileVersion } from "@/lib/mobile-release";
import { requirePagePermission } from "@/lib/page-auth";
import { AppReleaseManager } from "./app-release-manager";

export const dynamic = "force-dynamic";

export default async function AppReleasePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { ctx } = await requirePagePermission("workspace.manage");
  if (!ctx || ctx.tenantId !== id) redirect("/workspaces?error=forbidden");
  const version = await readMobileVersion();
  const apk = apkInfo();

  return (
    <main className="page page--narrow">
      <div className="page-head">
        <div>
          <p className="eyebrow">Distribusi aplikasi</p>
          <h1 className="page-title">Rilis aplikasi Android</h1>
          <p className="page-subtitle">
            Unggah APK baru agar karyawan menerima pembaruan langsung dari dalam
            aplikasi, tanpa perlu memasang ulang secara manual.
          </p>
        </div>
        <span
          className={
            version.forceUpdate ? "badge badge--yellow" : "badge badge--green"
          }
        >
          {version.forceUpdate ? "Wajib diperbarui" : "Pembaruan opsional"}
        </span>
      </div>
      <AppReleaseManager
        workspaceId={id}
        version={version}
        apk={
          apk
            ? {
                sizeBytes: apk.size,
                updatedAt: apk.updatedAt.toISOString(),
              }
            : null
        }
      />
    </main>
  );
}
