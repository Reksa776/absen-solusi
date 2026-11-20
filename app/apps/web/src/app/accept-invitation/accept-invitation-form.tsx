"use client";

import { useState, type FormEvent } from "react";

const CSRF_COOKIE = "aos_csrf";

function readCookie(name: string): string | null {
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1] ?? "") : null;
}

async function ensureCsrfToken(): Promise<string> {
  const existing = readCookie(CSRF_COOKIE);
  if (existing) return existing;
  const response = await fetch("/api/auth/csrf", { credentials: "same-origin" });
  const body = (await response.json()) as { csrfToken?: string };
  if (!body.csrfToken) throw new Error("Gagal memperoleh token CSRF");
  return body.csrfToken;
}

type AcceptResult = {
  workspace?: { id: string; name: string; slug: string };
  roleKey?: string;
  error?: { code?: string; message?: string };
};

export function AcceptInvitationForm({ token }: { token: string }) {
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AcceptResult | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const csrfToken = await ensureCsrfToken();
      const response = await fetch("/api/invitations/accept", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json", "x-csrf-token": csrfToken },
        body: JSON.stringify({
          token,
          ...(name.trim() ? { name } : {}),
          ...(password ? { password } : {}),
        }),
      });
      const body = (await response.json()) as AcceptResult;
      if (!response.ok) {
        setError(body.error?.message ?? "Undangan gagal diterima");
        return;
      }
      setResult(body);
    } catch {
      setError("Tidak dapat menghubungi server");
    } finally {
      setBusy(false);
    }
  }

  if (result?.workspace) {
    return (
      <section role="status" style={{ padding: "1rem", background: "#e8f5e9" }}>
        <h2 style={{ fontSize: "1.1rem", marginTop: 0 }}>Undangan diterima</h2>
        <p>
          Anda sekarang menjadi member <strong>{result.workspace.name}</strong> dengan role{" "}
          <strong>{result.roleKey}</strong>.
        </p>
        <a href="/workspaces">Buka daftar workspace</a>
      </section>
    );
  }

  return (
    <form onSubmit={onSubmit} style={{ display: "grid", gap: "0.75rem" }}>
      <p style={{ margin: 0, color: "#555" }}>
        Untuk akun baru, isi nama dan password. Untuk akun yang sudah ada, login
        lalu buka kembali tautan ini.
      </p>
      <label style={{ display: "grid", gap: "0.25rem" }}>
        Nama (akun baru)
        <input
          type="text"
          autoComplete="name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          style={{ padding: "0.5rem" }}
        />
      </label>
      <label style={{ display: "grid", gap: "0.25rem" }}>
        Password (akun baru)
        <input
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          style={{ padding: "0.5rem" }}
        />
      </label>
      {error ? (
        <p role="alert" style={{ color: "#b00020", margin: 0 }}>
          {error}
        </p>
      ) : null}
      <button type="submit" disabled={busy} style={{ padding: "0.6rem" }}>
        {busy ? "Memproses…" : "Terima undangan"}
      </button>
    </form>
  );
}
