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
    <main
      style={{
        fontFamily: "system-ui, sans-serif",
        maxWidth: "48rem",
        margin: "0 auto",
        padding: "3rem 1.5rem",
        lineHeight: 1.6,
      }}
    >
      <p>
        <Link href={ctx ? `/workspaces/${ctx.tenantId}/dashboard` : "/workspaces"}>
          ← Kembali
        </Link>
      </p>
      <h1 style={{ fontSize: "1.5rem" }}>Keamanan akun</h1>
      <p style={{ color: "#555" }}>
        Lindungi akun Admin/Owner dengan kode TOTP dari Google Authenticator, Authy,
        atau aplikasi yang kompatibel dengan RFC 6238.
      </p>
      <SecuritySettings enabled={user?.twoFactorEnabled === true} />
    </main>
  );
}
