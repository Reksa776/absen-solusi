"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

const CSRF_COOKIE = "aos_csrf";
const MIN_REJECTION_REASON = 10;

type Correction = {
  id: string;
  requestType: string;
  requestedTimestamp: string;
  originalTimestamp: string | null;
  reason: string;
  proofUrl: string | null;
  status: string;
  rejectionReason: string | null;
  member: { id: string; name: string; email: string };
  reviewer: { id: string; name: string; email: string } | null;
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

function stamp(value: string | null): string {
  if (!value) return "—";
  return `${value.slice(0, 16).replace("T", " ")} UTC`;
}

function typeLabel(value: string): string {
  return value === "CHECK_OUT" ? "Check-out" : "Check-in";
}

function statusLabel(value: string): string {
  if (value === "APPROVED") return "Disetujui";
  if (value === "REJECTED") return "Ditolak";
  return "Menunggu";
}

function statusBadge(value: string): string {
  if (value === "APPROVED") return "badge badge--green";
  if (value === "REJECTED") return "badge badge--red";
  return "badge badge--yellow";
}

export function CorrectionQueue({
  workspaceId,
  corrections,
  canReview,
}: {
  workspaceId: string;
  corrections: Correction[];
  canReview: boolean;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<{
    correction: Correction;
    action: "approve" | "reject";
  } | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  function open(correction: Correction, action: "approve" | "reject") {
    setSelected({ correction, action });
    setReason("");
    setError(null);
    setNotice(null);
  }

  function close() {
    if (busy) return;
    setSelected(null);
    setReason("");
    setError(null);
  }

  async function confirm() {
    if (!selected) return;
    const trimmed = reason.trim();
    if (selected.action === "reject" && trimmed.length < MIN_REJECTION_REASON) {
      setError(`Alasan penolakan minimal ${MIN_REJECTION_REASON} karakter.`);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const token = await csrfToken();
      const response = await fetch(`/api/corrections/${selected.correction.id}`, {
        method: "PATCH",
        credentials: "same-origin",
        headers: { "content-type": "application/json", "x-csrf-token": token },
        body: JSON.stringify(
          selected.action === "reject"
            ? { action: "reject", rejectionReason: trimmed }
            : { action: "approve" },
        ),
      });
      const body = (await response.json().catch(() => ({}))) as {
        error?: { message?: string };
      };
      if (!response.ok) {
        setError(body.error?.message ?? "Revisi tidak dapat diproses.");
        return;
      }
      setSelected(null);
      setReason("");
      setNotice(
        selected.action === "approve" ? "Revisi disetujui." : "Revisi ditolak.",
      );
      router.refresh();
    } catch {
      setError("Tidak dapat menghubungi server.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section>
      {error && !selected ? (
        <p role="alert" className="alert">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p role="status" className="notice">
          {notice}
        </p>
      ) : null}

      <div className="table-wrap">
        <div className="table-head">
          <div>
            <h2 className="section-title">Revisi kehadiran</h2>
            <p className="section-note">{corrections.length} entri pada filter ini</p>
          </div>
          <span className="badge badge--neutral">{statusLabel("PENDING")} diprioritaskan</span>
        </div>
        <div className="table-scroll">
          <table className="data">
            <thead>
              <tr>
                {["Member", "Tipe", "Tanggal diminta", "Alasan", "Bukti", "Status", "Aksi"].map(
                  (label) => (
                    <th key={label}>{label}</th>
                  ),
                )}
              </tr>
            </thead>
            <tbody>
              {corrections.length === 0 ? (
                <tr>
                  <td colSpan={7} className="empty">
                    Belum ada revisi pada filter ini.
                  </td>
                </tr>
              ) : null}
              {corrections.map((correction) => (
                <tr key={correction.id}>
                  <td>
                    <span className="cell-title">{correction.member.name}</span>
                    <span className="cell-sub">{correction.member.email}</span>
                  </td>
                  <td>{typeLabel(correction.requestType)}</td>
                  <td className="mono nowrap">{stamp(correction.requestedTimestamp)}</td>
                  <td style={{ maxWidth: "22rem" }}>{correction.reason}</td>
                  <td>
                    {correction.proofUrl ? (
                      <a
                        href={`/api/corrections/${correction.id}/proof`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Lihat bukti
                      </a>
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>
                  <td>
                    <span className={statusBadge(correction.status)}>
                      {statusLabel(correction.status)}
                    </span>
                  </td>
                  <td className="nowrap">
                    <div className="btn-row">
                      <Link
                        href={`/workspaces/${workspaceId}/corrections/${correction.id}`}
                        className="btn btn--ghost btn--sm"
                      >
                        Detail
                      </Link>
                      {canReview && correction.status === "PENDING" ? (
                        <>
                          <button
                            type="button"
                            data-testid={`approve-${correction.id}`}
                            className="btn btn--primary btn--sm"
                            onClick={() => open(correction, "approve")}
                          >
                            Approve
                          </button>
                          <button
                            type="button"
                            data-testid={`reject-${correction.id}`}
                            className="btn btn--danger btn--sm"
                            onClick={() => open(correction, "reject")}
                          >
                            Reject
                          </button>
                        </>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {selected ? (
        <div
          role="dialog"
          aria-modal="true"
          data-testid="correction-review-dialog"
          className="modal-backdrop"
        >
          <div className="modal">
            <h2>{selected.action === "approve" ? "Setujui revisi?" : "Tolak revisi"}</h2>
            <p className="modal-sub">
              {selected.correction.member.name} ·{" "}
              {typeLabel(selected.correction.requestType)} ·{" "}
              {stamp(selected.correction.requestedTimestamp)}
            </p>
            {selected.action === "approve" ? (
              <p style={{ fontSize: "0.85rem", color: "var(--muted)" }}>
                Absensi akan diperbarui dari{" "}
                <strong className="mono">{stamp(selected.correction.originalTimestamp)}</strong>{" "}
                menjadi{" "}
                <strong className="mono">{stamp(selected.correction.requestedTimestamp)}</strong>.
              </p>
            ) : (
              <label className="field">
                Alasan penolakan (wajib, minimal {MIN_REJECTION_REASON} karakter)
                <textarea
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  rows={4}
                  disabled={busy}
                />
              </label>
            )}
            {error ? (
              <p role="alert" className="alert" style={{ marginTop: "0.75rem" }}>
                {error}
              </p>
            ) : null}
            <div className="modal-actions">
              <button type="button" className="btn btn--secondary" onClick={close} disabled={busy}>
                Batal
              </button>
              <button
                type="button"
                className={selected.action === "approve" ? "btn btn--primary" : "btn btn--danger"}
                onClick={confirm}
                disabled={busy}
              >
                {busy
                  ? "Memproses…"
                  : selected.action === "approve"
                    ? "Setujui"
                    : "Tolak revisi"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
