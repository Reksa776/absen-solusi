"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function SignOutButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function signOut() {
    setBusy(true);
    try {
      const match = document.cookie.match(/(?:^|; )aos_csrf=([^;]*)/);
      const csrfToken = match ? decodeURIComponent(match[1] ?? "") : "";
      await fetch("/api/auth/logout", {
        method: "POST",
        credentials: "same-origin",
        headers: { "x-csrf-token": csrfToken },
      });
      router.replace("/sign-in");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <button type="button" className="btn btn--secondary" onClick={signOut} disabled={busy}>
      {busy ? "Keluar…" : "Keluar"}
    </button>
  );
}
