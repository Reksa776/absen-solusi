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
    <main
      style={{
        fontFamily: "system-ui, sans-serif",
        maxWidth: "32rem",
        margin: "0 auto",
        padding: "4rem 1.5rem",
        lineHeight: 1.6,
      }}
    >
      <h1 style={{ fontSize: "1.5rem" }}>Terima undangan workspace</h1>
      <p style={{ color: "#555" }}>
        Undangan ini mengaktifkan keanggotaan Anda. Jika akun sudah ada, login
        terlebih dahulu; jika belum, isi nama dan password.
      </p>
      {token ? (
        <AcceptInvitationForm token={token} />
      ) : (
        <p role="alert" style={{ color: "#b00020" }}>
          Token undangan tidak ditemukan pada URL.
        </p>
      )}
      <p style={{ marginTop: "1.5rem" }}>
        <Link href="/sign-in">Kembali ke halaman masuk</Link>
      </p>
    </main>
  );
}
