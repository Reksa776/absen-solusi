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
      <p style={{ marginTop: 0 }}>
        Status:{" "}
        <span className={enabled ? "badge badge--green" : "badge badge--neutral"}>
          {enabled ? "Aktif" : "Belum aktif"}
        </span>
      </p>
      {error ? <p role="alert" className="alert">{error}</p> : null}
      {notice ? <p role="status" className="notice">{notice}</p> : null}

      {!enabled && !setup ? (
        <button
          type="button"
          onClick={() => void startSetup()}
          disabled={busy}
          className="btn btn--primary"
        >
          {busy ? "Menyiapkan…" : "Aktifkan 2FA"}
        </button>
      ) : null}

      {setup ? (
        <div className="card card-pad" style={{ marginTop: "0.75rem" }}>
          <p style={{ marginTop: 0 }}>Tambahkan akun di aplikasi authenticator dengan URI berikut:</p>
          <code className="mono" style={{ display: "block", overflowWrap: "anywhere", background: "var(--table-head)", padding: "0.6rem", borderRadius: "8px" }}>
            {setup.otpauthUri}
          </code>
          <p>Secret manual: <code className="mono">{setup.secret}</code></p>
          <p><strong>Backup codes (hanya ditampilkan sekali):</strong></p>
          <ul style={{ columns: 2 }}>
            {setup.backupCodes.map((backup) => <li key={backup}><code className="mono">{backup}</code></li>)}
          </ul>
          <form onSubmit={verify} className="form-row">
            <label className="field">
              Kode 6 digit
              <input
                inputMode="numeric"
                autoComplete="one-time-code"
                value={code}
                onChange={(event) => setCode(event.target.value)}
                required
              />
            </label>
            <button type="submit" disabled={busy} className="btn btn--primary">
              Verifikasi & aktifkan
            </button>
          </form>
        </div>
      ) : null}

      {enabled ? (
        <form onSubmit={disable} className="stack" style={{ maxWidth: "26rem", marginTop: "1rem" }}>
          <h2 className="section-title">Nonaktifkan 2FA</h2>
          <label className="field">
            Password
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
          </label>
          <label className="field">
            Kode TOTP
            <input
              inputMode="numeric"
              autoComplete="one-time-code"
              value={code}
              onChange={(event) => setCode(event.target.value)}
              required
            />
          </label>
          <button type="submit" disabled={busy} className="btn btn--danger">
            Nonaktifkan
          </button>
        </form>
      ) : null}
    </section>
  );
}
