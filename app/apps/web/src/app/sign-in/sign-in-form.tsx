"use client";

import { useRouter } from "next/navigation";
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

export function SignInForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [challengeToken, setChallengeToken] = useState<string | null>(null);
  const [code, setCode] = useState("");

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const csrfToken = await ensureCsrfToken();
      const response = await fetch("/api/auth/login", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json", "x-csrf-token": csrfToken },
        body: JSON.stringify({ email, password }),
      });
      const body = (await response.json()) as {
        error?: { message?: string };
        requiresTwoFactor?: boolean;
        challengeToken?: string;
        redirectTo?: string | null;
      };
      if (response.status === 202 && body.requiresTwoFactor && body.challengeToken) {
        setChallengeToken(body.challengeToken);
        setCode("");
        return;
      }
      if (!response.ok) {
        setError(body.error?.message ?? "Gagal masuk");
        return;
      }
      router.replace(body.redirectTo ?? "/");
      router.refresh();
    } catch {
      setError("Tidak dapat menghubungi server");
    } finally {
      setBusy(false);
    }
  }

  async function onVerify(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!challengeToken) return;
    setBusy(true);
    setError(null);
    try {
      const csrfToken = await ensureCsrfToken();
      const response = await fetch("/api/auth/login/2fa", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json", "x-csrf-token": csrfToken },
        body: JSON.stringify({ challengeToken, code }),
      });
      const body = (await response.json()) as {
        error?: { message?: string };
        redirectTo?: string | null;
      };
      if (!response.ok) {
        setError(body.error?.message ?? "Kode 2FA tidak valid");
        return;
      }
      router.replace(body.redirectTo ?? "/");
      router.refresh();
    } catch {
      setError("Tidak dapat menghubungi server");
    } finally {
      setBusy(false);
    }
  }

  if (challengeToken) {
    return (
      <form onSubmit={onVerify} style={{ display: "grid", gap: "0.75rem" }}>
        <p style={{ margin: 0 }}>
          Masukkan kode 6 digit dari aplikasi authenticator, atau salah satu backup code.
        </p>
        <label style={{ display: "grid", gap: "0.25rem" }}>
          Kode 2FA
          <input
            autoComplete="one-time-code"
            inputMode="numeric"
            required
            value={code}
            onChange={(event) => setCode(event.target.value)}
            style={{ padding: "0.5rem" }}
          />
        </label>
        {error ? (
          <p role="alert" style={{ color: "#b00020", margin: 0 }}>
            {error}
          </p>
        ) : null}
        <button type="submit" disabled={busy} style={{ padding: "0.6rem" }}>
          {busy ? "Memverifikasi…" : "Verifikasi 2FA"}
        </button>
        <button
          type="button"
          onClick={() => {
            setChallengeToken(null);
            setCode("");
            setError(null);
          }}
          style={{ padding: "0.5rem" }}
        >
          Kembali
        </button>
      </form>
    );
  }

  return (
    <form onSubmit={onSubmit} style={{ display: "grid", gap: "0.75rem" }}>
      <label style={{ display: "grid", gap: "0.25rem" }}>
        Email
        <input
          type="email"
          autoComplete="username"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          style={{ padding: "0.5rem" }}
        />
      </label>
      <label style={{ display: "grid", gap: "0.25rem" }}>
        Password
        <input
          type="password"
          autoComplete="current-password"
          required
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
        {busy ? "Memproses…" : "Masuk"}
      </button>
    </form>
  );
}
