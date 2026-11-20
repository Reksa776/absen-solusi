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
      <section role="status" className="notice">
        <h2 style={{ fontSize: "1.05rem", marginTop: 0 }}>Undangan diterima</h2>
        <p style={{ margin: "0.3rem 0", color: "inherit" }}>
          Anda sekarang menjadi member <strong>{result.workspace.name}</strong> dengan role{" "}
          <strong>{result.roleKey}</strong>.
        </p>
        <a href="/workspaces">Buka daftar workspace</a>
      </section>
    );
  }

  return (
    <form onSubmit={onSubmit} className="stack">
      <p style={{ margin: 0, color: "var(--muted)", fontSize: "0.82rem" }}>
        Untuk akun baru, isi nama dan password. Untuk akun yang sudah ada, login
        lalu buka kembali tautan ini.
      </p>
      <label className="field">
        Nama (akun baru)
        <input
          type="text"
          autoComplete="name"
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
      </label>
      <label className="field">
        Password (akun baru)
        <input
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
      </label>
      {error ? (
        <p role="alert" className="alert" style={{ margin: 0 }}>
          {error}
        </p>
      ) : null}
      <button type="submit" className="btn btn--primary btn--block" disabled={busy}>
        {busy ? "Memproses…" : "Terima undangan"}
      </button>
    </form>
  );
}
