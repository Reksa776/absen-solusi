"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

const CSRF_COOKIE = "aos_csrf";

type BroadcastRow = {
  id: string;
  title: string;
  content: string;
  audienceType: string;
  divisionId: string | null;
  divisionName: string | null;
  locationId: string | null;
  locationName: string | null;
  priority: string;
  publishedAt: string | null;
  createdByName: string;
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

function audienceLabel(row: BroadcastRow): string {
  if (row.audienceType === "DIVISION") return row.divisionName ?? "Divisi";
  if (row.audienceType === "LOCATION") return row.locationName ?? "Lokasi";
  return "Semua karyawan";
}

function formatTime(value: string | null): string {
  if (!value) return "Belum dipublikasikan";
  return new Date(value).toLocaleString("id-ID", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export function BroadcastManager({
  workspaceId,
  broadcasts,
  divisions,
  offices,
  canManage,
}: {
  workspaceId: string;
  broadcasts: BroadcastRow[];
  divisions: Array<{ id: string; name: string }>;
  offices: Array<{ id: string; name: string }>;
  canManage: boolean;
}) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [audienceType, setAudienceType] = useState("ALL");
  const [divisionId, setDivisionId] = useState(divisions[0]?.id ?? "");
  const [locationId, setLocationId] = useState(offices[0]?.id ?? "");
  const [priority, setPriority] = useState("NORMAL");
  const [publishNow, setPublishNow] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (content.trim().length < 5) {
      setError("Isi pengumuman minimal 5 karakter.");
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const token = await csrfToken();
      const response = await fetch(`/api/workspaces/${workspaceId}/broadcasts`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json", "x-csrf-token": token },
        body: JSON.stringify({
          title: title.trim(),
          content: content.trim(),
          audienceType,
          divisionId: audienceType === "DIVISION" ? divisionId : null,
          locationId: audienceType === "LOCATION" ? locationId : null,
          priority,
          publishNow,
        }),
      });
      const body = (await response.json().catch(() => ({}))) as {
        error?: { message?: string };
      };
      if (!response.ok) {
        setError(body.error?.message ?? "Broadcast gagal dibuat.");
        return;
      }
      setNotice(publishNow ? "Broadcast dipublikasikan." : "Broadcast disimpan sebagai draf.");
      setTitle("");
      setContent("");
      router.refresh();
    } catch {
      setError("Tidak dapat menghubungi server.");
    } finally {
      setBusy(false);
    }
  }

  async function publish(row: BroadcastRow) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const token = await csrfToken();
      const response = await fetch(
        `/api/workspaces/${workspaceId}/broadcasts/${row.id}/publish`,
        {
          method: "POST",
          credentials: "same-origin",
          headers: { "x-csrf-token": token },
        },
      );
      const body = (await response.json().catch(() => ({}))) as {
        error?: { message?: string };
      };
      if (!response.ok) {
        setError(body.error?.message ?? "Broadcast gagal dipublikasikan.");
        return;
      }
      setNotice("Broadcast dipublikasikan ke audiens target.");
      router.refresh();
    } catch {
      setError("Tidak dapat menghubungi server.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack">
      {canManage ? (
        <form className="form-card" onSubmit={submit}>
          <div className="form-head">
            <div>
              <h2 className="section-title">Buat pengumuman</h2>
              <p className="section-note">
                Hanya pengumuman yang dipublikasikan yang terlihat di aplikasi karyawan.
              </p>
            </div>
            <span className="badge badge--neutral">{broadcasts.length} total</span>
          </div>

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
            <label className="field form-span">
              Judul
              <input
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                minLength={3}
                maxLength={160}
                required
                disabled={busy}
                placeholder="Contoh: Perubahan jam operasional kantor"
              />
            </label>
            <label className="field form-span">
              Isi pengumuman
              <textarea
                value={content}
                onChange={(event) => setContent(event.target.value)}
                minLength={5}
                maxLength={2000}
                rows={4}
                required
                disabled={busy}
                placeholder="Tulis informasi yang jelas: apa, kapan, dan dampaknya bagi karyawan."
              />
            </label>
            <label className="field">
              Target audiens
              <select
                value={audienceType}
                onChange={(event) => setAudienceType(event.target.value)}
                disabled={busy}
              >
                <option value="ALL">Semua karyawan</option>
                <option value="DIVISION">Divisi tertentu</option>
                <option value="LOCATION">Lokasi kerja tertentu</option>
              </select>
            </label>
            {audienceType === "DIVISION" ? (
              <label className="field">
                Divisi
                <select
                  value={divisionId}
                  onChange={(event) => setDivisionId(event.target.value)}
                  disabled={busy}
                  required
                >
                  {divisions.length === 0 ? <option value="">Belum ada divisi</option> : null}
                  {divisions.map((division) => (
                    <option key={division.id} value={division.id}>
                      {division.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            {audienceType === "LOCATION" ? (
              <label className="field">
                Lokasi
                <select
                  value={locationId}
                  onChange={(event) => setLocationId(event.target.value)}
                  disabled={busy}
                  required
                >
                  {offices.length === 0 ? <option value="">Belum ada lokasi</option> : null}
                  {offices.map((office) => (
                    <option key={office.id} value={office.id}>
                      {office.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            <label className="field">
              Prioritas
              <select
                value={priority}
                onChange={(event) => setPriority(event.target.value)}
                disabled={busy}
              >
                <option value="NORMAL">Normal</option>
                <option value="PENTING">Penting</option>
              </select>
            </label>
            <label className="field--check">
              <input
                type="checkbox"
                checked={publishNow}
                onChange={(event) => setPublishNow(event.target.checked)}
                disabled={busy}
              />
              Publikasikan sekarang
            </label>
          </div>
          <div className="btn-row" style={{ marginTop: "0.9rem" }}>
            <button type="submit" className="btn btn--primary" disabled={busy}>
              {busy ? "Menyimpan…" : publishNow ? "Publikasikan" : "Simpan draf"}
            </button>
          </div>
        </form>
      ) : null}

      <div className="table-wrap">
        <div className="table-head">
          <div>
            <h2 className="section-title">Daftar broadcast</h2>
            <p className="section-note">
              <span className="num">
                {broadcasts.filter((row) => row.publishedAt).length}
              </span>{" "}
              terpublikasi ·{" "}
              <span className="num">
                {broadcasts.filter((row) => !row.publishedAt).length}
              </span>{" "}
              draf
            </p>
          </div>
        </div>
        <div className="table-scroll">
          <table className="data">
            <thead>
              <tr>
                <th>Pengumuman</th>
                <th>Audiens</th>
                <th>Prioritas</th>
                <th>Publikasi</th>
                <th>Pembuat</th>
                <th>Aksi</th>
              </tr>
            </thead>
            <tbody>
              {broadcasts.length === 0 ? (
                <tr>
                  <td colSpan={6} className="empty">
                    Belum ada broadcast.
                  </td>
                </tr>
              ) : null}
              {broadcasts.map((row) => (
                <tr key={row.id}>
                  <td style={{ maxWidth: "24rem" }}>
                    <span className="cell-title">{row.title}</span>
                    <span className="cell-sub">{row.content}</span>
                  </td>
                  <td>{audienceLabel(row)}</td>
                  <td>
                    <span
                      className={
                        row.priority === "PENTING"
                          ? "badge badge--yellow"
                          : "badge badge--neutral"
                      }
                    >
                      {row.priority === "PENTING" ? "Penting" : "Normal"}
                    </span>
                  </td>
                  <td>
                    {row.publishedAt ? (
                      <span className="badge badge--green">Terpublikasi</span>
                    ) : (
                      <span className="badge badge--neutral">Draf</span>
                    )}
                    <span className="cell-sub">{formatTime(row.publishedAt)}</span>
                  </td>
                  <td>{row.createdByName}</td>
                  <td>
                    {canManage && !row.publishedAt ? (
                      <button
                        type="button"
                        className="btn btn--primary btn--sm"
                        disabled={busy}
                        onClick={() => publish(row)}
                      >
                        Publikasikan
                      </button>
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
