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

export function MobileSettingsForm({
  workspaceId,
  initialRequireDeviceApproval,
  initialAutoApproveFirstDevice,
  canManage,
}: {
  workspaceId: string;
  initialRequireDeviceApproval: boolean;
  initialAutoApproveFirstDevice: boolean;
  canManage: boolean;
}) {
  const router = useRouter();
  const [required, setRequired] = useState(initialRequireDeviceApproval);
  const [autoFirst, setAutoFirst] = useState(initialAutoApproveFirstDevice);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const token = await csrfToken();
      const response = await fetch(
        `/api/workspaces/${workspaceId}/settings/mobile`,
        {
          method: "PATCH",
          credentials: "same-origin",
          headers: { "content-type": "application/json", "x-csrf-token": token },
          body: JSON.stringify({
            requireDeviceApproval: required,
            autoApproveFirstDevice: autoFirst,
          }),
        },
      );
      const body = (await response.json().catch(() => ({}))) as {
        error?: { message?: string };
      };
      if (!response.ok) {
        setError(body.error?.message ?? "Pengaturan gagal disimpan.");
        return;
      }
      setNotice("Pengaturan mobile disimpan.");
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

      <div className="card-head" style={{ padding: "0 0 0.85rem", borderBottom: "none" }}>
        <div>
          <h2 className="section-title">Wajib persetujuan perangkat baru</h2>
          <p className="section-note">
            Perangkat yang belum disetujui tidak dapat check-in atau check-out.
          </p>
        </div>
        <span className={required ? "badge badge--yellow" : "badge badge--neutral"}>
          {required ? "Wajib" : "Nonaktif"}
        </span>
      </div>

      <label className="field--check" style={{ marginTop: "0.8rem" }}>
        <input
          type="checkbox"
          checked={required}
          onChange={(event) => setRequired(event.target.checked)}
          disabled={!canManage || busy}
        />
        Wajibkan persetujuan perangkat sebelum absensi
      </label>

      <label className="field--check" style={{ marginTop: "0.65rem" }}>
        <input
          type="checkbox"
          checked={autoFirst}
          onChange={(event) => setAutoFirst(event.target.checked)}
          disabled={!canManage || busy || !required}
        />
        Setujui otomatis perangkat pertama karyawan
      </label>

      <p className="section-note" style={{ marginTop: "0.65rem" }}>
        Jika kebijakan wajib aktif dan opsi pertama dimatikan, semua perangkat baru
        masuk antrean <strong>Menunggu</strong>. Reset perangkat dapat dilakukan dari
        halaman Persetujuan Perangkat saat karyawan berganti HP. Sesi mobile lama
        tidak otomatis dicabut.
      </p>

      {canManage ? (
        <div className="btn-row" style={{ marginTop: "0.9rem" }}>
          <button type="button" className="btn btn--primary" onClick={save} disabled={busy}>
            {busy ? "Menyimpan…" : "Simpan pengaturan"}
          </button>
        </div>
      ) : (
        <p className="section-note" style={{ marginTop: "0.8rem" }}>
          Hanya admin dengan izin kelola karyawan yang dapat mengubah pengaturan ini.
        </p>
      )}
    </section>
  );
}
