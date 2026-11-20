"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

const CSRF_COOKIE = "aos_csrf";

type SetupResult = {
  secret: string;
  otpauthUri: string;
  backupCodes: string[];
};

function readCookie(name: string): string | null {
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1] ?? "") : null;
}

async function csrfToken(): Promise<string> {
  const existing = readCookie(CSRF_COOKIE);
  if (existing) return existing;
  const response = await fetch("/api/auth/csrf", { credentials: "same-origin" });
  const body = (await response.json()) as { csrfToken?: string };
  if (!body.csrfToken) throw new Error("CSRF token tidak tersedia");
  return body.csrfToken;
}

async function postJson(path: string, body: unknown): Promise<Response> {
  return fetch(path, {
    method: "POST",
    credentials: "same-origin",
    headers: { "content-type": "application/json", "x-csrf-token": await csrfToken() },
    body: JSON.stringify(body),
  });
}

export function SecuritySettings({ enabled }: { enabled: boolean }) {
  const router = useRouter();
  const [setup, setSetup] = useState<SetupResult | null>(null);
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function startSetup(): Promise<void> {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const response = await postJson("/api/auth/2fa/setup", {});
      const body = (await response.json().catch(() => ({}))) as SetupResult & {
        error?: { message?: string };
      };
      if (!response.ok) {
        setError(body.error?.message ?? "Setup 2FA gagal");
        return;
      }
      setSetup(body);
      setNotice("Scan URI di authenticator, lalu masukkan kode 6 digit untuk mengaktifkan.");
    } catch {
      setError("Tidak dapat menghubungi server.");
    } finally {
      setBusy(false);
    }
  }

  async function verify(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const response = await postJson("/api/auth/2fa/verify-setup", { code });
      const body = (await response.json().catch(() => ({}))) as {
        error?: { message?: string };
      };
      if (!response.ok) {
        setError(body.error?.message ?? "Kode 2FA tidak valid");
        return;
      }
      setSetup(null);
      setCode("");
      setNotice("2FA aktif. Simpan backup code di tempat aman.");
      router.refresh();
    } catch {
      setError("Tidak dapat menghubungi server.");
    } finally {
      setBusy(false);
    }
  }

  async function disable(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const response = await postJson("/api/auth/2fa/disable", { password, code });
      const body = (await response.json().catch(() => ({}))) as {
        error?: { message?: string };
      };
      if (!response.ok) {
        setError(body.error?.message ?? "2FA tidak dapat dinonaktifkan");
        return;
      }
      setPassword("");
      setCode("");
      setNotice("2FA dinonaktifkan.");
      router.refresh();
    } catch {
      setError("Tidak dapat menghubungi server.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section>
      <p>
        Status: <strong>{enabled ? "Aktif" : "Belum aktif"}</strong>
      </p>
      {error ? <p role="alert" style={{ color: "#b00020" }}>{error}</p> : null}
      {notice ? <p role="status">{notice}</p> : null}

      {!enabled && !setup ? (
        <button type="button" onClick={() => void startSetup()} disabled={busy} style={{ padding: "0.6rem 1rem" }}>
          {busy ? "Menyiapkan…" : "Aktifkan 2FA"}
        </button>
      ) : null}

      {setup ? (
        <div style={{ border: "1px solid #ddd", borderRadius: "0.5rem", padding: "1rem" }}>
          <p>Tambahkan akun di aplikasi authenticator dengan URI berikut:</p>
          <code style={{ display: "block", overflowWrap: "anywhere", background: "#f5f5f5", padding: "0.6rem" }}>
            {setup.otpauthUri}
          </code>
          <p>Secret manual: <code>{setup.secret}</code></p>
          <p><strong>Backup codes (hanya ditampilkan sekali):</strong></p>
          <ul style={{ columns: 2 }}>
            {setup.backupCodes.map((backup) => <li key={backup}><code>{backup}</code></li>)}
          </ul>
          <form onSubmit={verify} style={{ display: "flex", gap: "0.5rem", alignItems: "end" }}>
            <label>
              Kode 6 digit
              <br />
              <input
                inputMode="numeric"
                autoComplete="one-time-code"
                value={code}
                onChange={(event) => setCode(event.target.value)}
                required
                style={{ padding: "0.5rem" }}
              />
            </label>
            <button type="submit" disabled={busy} style={{ padding: "0.55rem 0.9rem" }}>
              Verifikasi & aktifkan
            </button>
          </form>
        </div>
      ) : null}

      {enabled ? (
        <form onSubmit={disable} style={{ display: "grid", gap: "0.6rem", maxWidth: "26rem", marginTop: "1rem" }}>
          <h2 style={{ fontSize: "1.1rem", marginBottom: 0 }}>Nonaktifkan 2FA</h2>
          <label>
            Password
            <br />
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
              style={{ padding: "0.5rem", width: "100%" }}
            />
          </label>
          <label>
            Kode TOTP
            <br />
            <input
              inputMode="numeric"
              autoComplete="one-time-code"
              value={code}
              onChange={(event) => setCode(event.target.value)}
              required
              style={{ padding: "0.5rem", width: "100%" }}
            />
          </label>
          <button type="submit" disabled={busy} style={{ padding: "0.55rem 0.9rem" }}>
            Nonaktifkan
          </button>
        </form>
      ) : null}
    </section>
  );
}
