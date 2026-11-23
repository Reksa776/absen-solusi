"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

const CSRF_COOKIE = "aos_csrf";

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

export function LeaveSettingsForm({
  workspaceId,
  initialQuota,
  year,
}: {
  workspaceId: string;
  initialQuota: number;
  year: number;
}) {
  const router = useRouter();
  const [quota, setQuota] = useState(String(initialQuota));
  const [resetUsed, setResetUsed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function savePolicy() {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const token = await csrfToken();
      const response = await fetch(
        `/api/workspaces/${workspaceId}/leave/settings`,
        {
          method: "PATCH",
          credentials: "same-origin",
          headers: { "content-type": "application/json", "x-csrf-token": token },
          body: JSON.stringify({ annualQuotaDays: Number(quota) }),
        },
      );
      const body = (await response.json().catch(() => ({}))) as {
        error?: { message?: string };
      };
      if (!response.ok) {
        setError(body.error?.message ?? "Pengaturan cuti gagal disimpan.");
        return;
      }
      setNotice("Jatah cuti tahunan disimpan.");
      router.refresh();
    } catch {
      setError("Tidak dapat menghubungi server.");
    } finally {
      setBusy(false);
    }
  }

  async function initialize() {
    if (
      resetUsed &&
      !window.confirm(
        "Reset pemakaian cuti tahun ini untuk seluruh karyawan? Tindakan ini tidak dapat dibatalkan.",
      )
    ) {
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const token = await csrfToken();
      const response = await fetch(
        `/api/workspaces/${workspaceId}/leave/balances/initialize`,
        {
          method: "POST",
          credentials: "same-origin",
          headers: { "content-type": "application/json", "x-csrf-token": token },
          body: JSON.stringify({ year, resetUsed }),
        },
      );
      const body = (await response.json().catch(() => ({}))) as {
        created?: number;
        reset?: number;
        error?: { message?: string };
      };
      if (!response.ok) {
        setError(body.error?.message ?? "Inisialisasi kuota gagal.");
        return;
      }
      setNotice(
        `Kuota ${year} siap. ${body.created ?? 0} karyawan baru diinisialisasi${
          resetUsed ? `, ${body.reset ?? 0} saldo direset` : ""
        }.`,
      );
      router.refresh();
    } catch {
      setError("Tidak dapat menghubungi server.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="form-card">
      {error ? (
        <p role="alert" className="alert">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p role="status" className="notice">
          {notice}
        </p>
      ) : null}

      <div className="form-grid">
        <label className="field">
          Jatah cuti tahunan default (hari)
          <input
            type="number"
            min={0}
            max={365}
            value={quota}
            onChange={(event) => setQuota(event.target.value)}
            disabled={busy}
          />
        </label>
        <label className="field--check">
          <input
            type="checkbox"
            checked={resetUsed}
            onChange={(event) => setResetUsed(event.target.checked)}
            disabled={busy}
          />
          Reset pemakaian saat inisialisasi
        </label>
      </div>

      <p className="section-note" style={{ marginTop: "0.7rem" }}>
        Inisialisasi membuat saldo tahun <span className="num">{year}</span> untuk semua
        karyawan aktif. Tanpa reset, pemakaian yang sudah ada tetap dipertahankan.
      </p>

      <div className="btn-row" style={{ marginTop: "0.9rem" }}>
        <button type="button" className="btn btn--primary" onClick={savePolicy} disabled={busy}>
          {busy ? "Menyimpan…" : "Simpan jatah"}
        </button>
        <button type="button" className="btn btn--secondary" onClick={initialize} disabled={busy}>
          Inisialisasi kuota {year}
        </button>
      </div>
    </section>
  );
}
