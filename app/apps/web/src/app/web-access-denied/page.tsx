import Link from "next/link";

import { SignOutButton } from "../sign-out-button";
import { WEB_EMPLOYEE_DENIED_MESSAGE } from "@/lib/web-access";

export const dynamic = "force-dynamic";

export default function WebAccessDeniedPage() {
  return (
    <main
      style={{
        fontFamily: "system-ui, sans-serif",
        maxWidth: "32rem",
        margin: "0 auto",
        padding: "4rem 1.5rem",
        lineHeight: 1.6,
      }}
    >
      <h1 style={{ fontSize: "1.5rem" }}>Akses web dibatasi</h1>
      <p role="alert" style={{ color: "#b00020", fontWeight: 600 }}>
        {WEB_EMPLOYEE_DENIED_MESSAGE}
      </p>
      <p style={{ color: "#555" }}>
        Akun karyawan tetap dapat melakukan absensi, melihat riwayat, dan mengajukan revisi
        melalui aplikasi Android. Hubungi Admin/HR jika Anda memerlukan akses dashboard web.
      </p>
      <div style={{ display: "flex", gap: "1rem", alignItems: "center" }}>
        <Link href="/sign-in">Kembali ke halaman masuk</Link>
        <SignOutButton />
      </div>
    </main>
  );
}
