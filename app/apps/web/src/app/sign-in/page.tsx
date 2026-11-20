import { sessionCookieName, validateSession } from "@absensi/auth";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { SignInForm } from "./sign-in-form";

export const dynamic = "force-dynamic";

export default async function SignInPage() {
  const token = (await cookies()).get(sessionCookieName())?.value;
  if (token && (await validateSession(token))) redirect("/");

  return (
    <main
      style={{
        fontFamily: "system-ui, sans-serif",
        maxWidth: "26rem",
        margin: "0 auto",
        padding: "4rem 1.5rem",
        lineHeight: 1.6,
      }}
    >
      <h1>Masuk</h1>
      <p>Gunakan akun workspace Anda.</p>
      <SignInForm />
    </main>
  );
}
