import { sessionCookieName, validateSession } from "@absensi/auth";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { SignInForm } from "./sign-in-form";

export const dynamic = "force-dynamic";

export default async function SignInPage() {
  const token = (await cookies()).get(sessionCookieName())?.value;
  if (token && (await validateSession(token))) redirect("/");

  return (
    <main className="auth-shell">
      <section className="auth-brand" aria-label="Tentang aplikasi">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            A
          </span>
          <div>
            <div className="brand-title">Absensi</div>
            <div className="brand-sub">Admin &amp; HR workspace</div>
          </div>
        </div>
        <div>
          <p className="eyebrow eyebrow--onGreen">Kehadiran terukur</p>
          <h1 className="auth-title">Absensi rapi, keputusan cepat.</h1>
          <p className="auth-copy">
            Pantau check-in GPS, revisi, lembur, WFH, dan payroll dari satu dashboard
            yang presisi.
          </p>
        </div>
        <ul className="auth-points">
          <li>Verifikasi geofence dan selfie</li>
          <li>Revisi kehadiran dengan bukti</li>
          <li>Rekap payroll siap unduh</li>
        </ul>
      </section>
      <section className="auth-form">
        <div className="auth-card">
          <div className="site-mark-mobile">
            <span className="brand-mark" aria-hidden="true">
              A
            </span>
            <strong style={{ fontFamily: "var(--font-sans)" }}>Absensi Admin</strong>
          </div>
          <h1 className="auth-heading">Masuk</h1>
          <p className="auth-sub">Gunakan akun workspace Anda.</p>
          <SignInForm />
          <p className="auth-note">
            Akses web khusus Admin/HR. Karyawan melakukan absensi melalui aplikasi
            Android.
          </p>
        </div>
      </section>
    </main>
  );
}
