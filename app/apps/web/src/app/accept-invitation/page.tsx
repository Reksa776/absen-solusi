import Link from "next/link";

import { AcceptInvitationForm } from "./accept-invitation-form";

export const dynamic = "force-dynamic";

export default async function AcceptInvitationPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string | string[] }>;
}) {
  const params = await searchParams;
  const token = typeof params.token === "string" ? params.token : "";

  return (
    <main className="centered-shell">
      <section className="centered-card">
        <div className="brand" style={{ padding: "0 0 1rem" }}>
          <span className="brand-mark" aria-hidden="true">
            A
          </span>
          <div>
            <div className="brand-title">Absensi Admin</div>
            <div className="brand-sub">Undangan workspace</div>
          </div>
        </div>
        <h1>Terima undangan workspace</h1>
        <p>
          Undangan ini mengaktifkan keanggotaan Anda. Jika akun sudah ada, login
          terlebih dahulu; jika belum, isi nama dan password.
        </p>
        {token ? (
          <AcceptInvitationForm token={token} />
        ) : (
          <p role="alert" className="alert">
            Token undangan tidak ditemukan pada URL.
          </p>
        )}
        <p style={{ marginTop: "1.25rem", fontSize: "0.8rem" }}>
          <Link href="/sign-in">Kembali ke halaman masuk</Link>
        </p>
      </section>
    </main>
  );
}
