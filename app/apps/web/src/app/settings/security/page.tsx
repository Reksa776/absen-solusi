import Link from "next/link";

import { systemDb } from "@absensi/database";

import { requirePagePermission } from "@/lib/page-auth";
import { SecuritySettings } from "./security-settings";

export const dynamic = "force-dynamic";

export default async function SecuritySettingsPage() {
  const { session, ctx } = await requirePagePermission();
  // SYSTEM: status keamanan user yang sedang login.
  const user = await systemDb().user.findUnique({
    where: { id: session.userId },
    select: { twoFactorEnabled: true },
  });

  return (
    <main className="page page--narrow">
      <Link href={ctx ? `/workspaces/${ctx.tenantId}/dashboard` : "/workspaces"} className="back-link">
        ← Kembali
      </Link>
      <div className="page-head">
        <div>
          <p className="eyebrow">Keamanan akun</p>
          <h1 className="page-title">Keamanan akun</h1>
          <p className="page-subtitle">
            Lindungi akun Admin/Owner dengan kode TOTP dari Google Authenticator, Authy,
            atau aplikasi yang kompatibel dengan RFC 6238.
          </p>
        </div>
      </div>
      <div className="card card-pad">
        <SecuritySettings enabled={user?.twoFactorEnabled === true} />
      </div>
    </main>
  );
}
