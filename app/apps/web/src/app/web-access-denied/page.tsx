import Link from "next/link";

import { SignOutButton } from "../sign-out-button";
import { WEB_EMPLOYEE_DENIED_MESSAGE } from "@/lib/web-access";

export const dynamic = "force-dynamic";

export default function WebAccessDeniedPage() {
  return (
    <main className="centered-shell">
      <section className="centered-card">
        <p className="eyebrow">Akses dibatasi</p>
        <h1>Akses web dibatasi</h1>
        <p role="alert" style={{ color: "#991b1b", fontWeight: 600, marginTop: "0.75rem" }}>
          {WEB_EMPLOYEE_DENIED_MESSAGE}
        </p>
        <p>
          Akun karyawan tetap dapat melakukan absensi, melihat riwayat, dan mengajukan
          revisi melalui aplikasi Android. Hubungi Admin/HR jika Anda memerlukan akses
          dashboard web.
        </p>
        <div className="btn-row">
          <Link href="/sign-in" className="btn btn--primary">
            Kembali ke halaman masuk
          </Link>
          <SignOutButton />
        </div>
      </section>
    </main>
  );
}
