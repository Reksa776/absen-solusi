"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

const CSRF_COOKIE = "aos_csrf";
const LEVELS = ["SP1", "SP2", "SP3"] as const;

type WarningRow = {
  id: string;
  memberId: string;
  memberName: string;
  memberEmail: string;
  level: string;
  letterNumber: string;
  issuedAt: string;
  validUntil: string;
  violationReason: string;
  acknowledgedAt: string | null;
  issuedByName: string;
  isActive: boolean;
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

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function plusDays(value: string, days: number): string {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function WarningLetterManager({
  workspaceId,
  letters,
  members,
  canManage,
}: {
  workspaceId: string;
  letters: WarningRow[];
  members: Array<{ id: string; name: string; email: string; divisionName: string | null }>;
  canManage: boolean;
}) {
  const router = useRouter();
  const [memberId, setMemberId] = useState(members[0]?.id ?? "");
  const [level, setLevel] = useState<(typeof LEVELS)[number]>("SP1");
  const [letterNumber, setLetterNumber] = useState("");
  const [issuedAt, setIssuedAt] = useState(today());
  const [validUntil, setValidUntil] = useState(plusDays(today(), 180));
  const [violationReason, setViolationReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!memberId) {
      setError("Pilih karyawan terlebih dahulu.");
      return;
    }
    if (violationReason.trim().length < 10) {
      setError("Alasan pelanggaran minimal 10 karakter.");
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const token = await csrfToken();
      const response = await fetch(`/api/workspaces/${workspaceId}/warning-letters`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json", "x-csrf-token": token },
        body: JSON.stringify({
          memberId,
          level,
          letterNumber: letterNumber.trim(),
          issuedAt,
          validUntil,
          violationReason: violationReason.trim(),
        }),
      });
      const body = (await response.json().catch(() => ({}))) as {
        error?: { message?: string };
      };
      if (!response.ok) {
        setError(body.error?.message ?? "Surat peringatan gagal diterbitkan.");
        return;
      }
      setNotice(`Surat peringatan ${level} berhasil diterbitkan.`);
      setLetterNumber("");
      setViolationReason("");
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
              <h2 className="section-title">Terbitkan SP baru</h2>
              <p className="section-note">
                Karyawan menerima notifikasi dan wajib mengonfirmasi sudah dibaca.
              </p>
            </div>
            <span className="badge badge--yellow">SP1–SP3</span>
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
            <label className="field">
              Karyawan
              <select
                value={memberId}
                onChange={(event) => setMemberId(event.target.value)}
                disabled={busy}
              >
                {members.length === 0 ? <option value="">Tidak ada karyawan</option> : null}
                {members.map((member) => (
                  <option key={member.id} value={member.id}>
                    {member.name} — {member.divisionName ?? "tanpa divisi"}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              Tingkat
              <select
                value={level}
                onChange={(event) =>
                  setLevel(event.target.value as (typeof LEVELS)[number])
                }
                disabled={busy}
              >
                {LEVELS.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              Nomor surat
              <input
                value={letterNumber}
                onChange={(event) => setLetterNumber(event.target.value)}
                placeholder="Contoh: SP/HR/2026/001"
                maxLength={80}
                required
                disabled={busy}
              />
            </label>
            <label className="field">
              Tanggal terbit
              <input
                type="date"
                value={issuedAt}
                onChange={(event) => setIssuedAt(event.target.value)}
                required
                disabled={busy}
              />
            </label>
            <label className="field">
              Berlaku sampai
              <input
                type="date"
                value={validUntil}
                min={issuedAt}
                onChange={(event) => setValidUntil(event.target.value)}
                required
                disabled={busy}
              />
            </label>
            <label className="field form-span">
              Alasan pelanggaran
              <textarea
                value={violationReason}
                onChange={(event) => setViolationReason(event.target.value)}
                minLength={10}
                maxLength={1000}
                rows={3}
                required
                disabled={busy}
                placeholder="Uraikan pelanggaran secara faktual, termasuk tanggal dan dampaknya."
              />
            </label>
          </div>
          <div className="btn-row" style={{ marginTop: "0.9rem" }}>
            <button type="submit" className="btn btn--primary" disabled={busy}>
              {busy ? "Menerbitkan…" : "Terbitkan surat peringatan"}
            </button>
          </div>
        </form>
      ) : (
        <p className="notice">Anda dapat melihat riwayat SP, tetapi tidak menerbitkan SP.</p>
      )}

      <div className="table-wrap">
        <div className="table-head">
          <div>
            <h2 className="section-title">Riwayat surat peringatan</h2>
            <p className="section-note">
              <span className="num">{letters.length}</span> surat ·{" "}
              <span className="num">{letters.filter((row) => row.isActive).length}</span>{" "}
              aktif
            </p>
          </div>
        </div>
        <div className="table-scroll">
          <table className="data">
            <thead>
              <tr>
                <th>Karyawan</th>
                <th>Tingkat</th>
                <th>Nomor</th>
                <th>Masa berlaku</th>
                <th>Pelanggaran</th>
                <th>Status baca</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {letters.length === 0 ? (
                <tr>
                  <td colSpan={7} className="empty">
                    Belum ada surat peringatan.
                  </td>
                </tr>
              ) : null}
              {letters.map((row) => (
                <tr key={row.id}>
                  <td>
                    <span className="cell-title">{row.memberName}</span>
                    <span className="cell-sub">{row.memberEmail}</span>
                  </td>
                  <td>
                    <span className="badge badge--neutral">{row.level}</span>
                  </td>
                  <td className="mono">{row.letterNumber}</td>
                  <td className="mono nowrap">
                    {row.issuedAt} – {row.validUntil}
                  </td>
                  <td style={{ maxWidth: "22rem" }}>{row.violationReason}</td>
                  <td>
                    {row.acknowledgedAt ? (
                      <span className="badge badge--green">Sudah dibaca</span>
                    ) : (
                      <span className="badge badge--yellow">Belum dibaca</span>
                    )}
                  </td>
                  <td>
                    {row.isActive ? (
                      <span className="badge badge--green">Aktif</span>
                    ) : (
                      <span className="badge badge--neutral">Berakhir</span>
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
