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
        <p role="alert" style={{ color: "#b00020" }}>
          {error}
        </p>
      ) : null}
      {notice ? <p role="status">{notice}</p> : null}

      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.9rem" }}>
        <thead>
          <tr>
            {["Member", "Tipe", "Tanggal diminta", "Alasan", "Bukti", "Status", "Aksi"].map(
              (label) => (
                <th
                  key={label}
                  style={{ textAlign: "left", borderBottom: "1px solid #ccc", padding: "0.5rem" }}
                >
                  {label}
                </th>
              ),
            )}
          </tr>
        </thead>
        <tbody>
          {corrections.length === 0 ? (
            <tr>
              <td colSpan={7} style={{ padding: "1rem", color: "#555" }}>
                Belum ada revisi pada filter ini.
              </td>
            </tr>
          ) : null}
          {corrections.map((correction) => (
            <tr key={correction.id}>
              <td style={{ padding: "0.5rem" }}>
                {correction.member.name}
                <br />
                <span style={{ color: "#555" }}>{correction.member.email}</span>
              </td>
              <td style={{ padding: "0.5rem" }}>{typeLabel(correction.requestType)}</td>
              <td style={{ padding: "0.5rem", whiteSpace: "nowrap" }}>
                {stamp(correction.requestedTimestamp)}
              </td>
              <td style={{ padding: "0.5rem", maxWidth: "22rem" }}>{correction.reason}</td>
              <td style={{ padding: "0.5rem" }}>
                {correction.proofUrl ? (
                  <a
                    href={`/api/corrections/${correction.id}/proof`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Lihat bukti
                  </a>
                ) : (
                  "—"
                )}
              </td>
              <td style={{ padding: "0.5rem" }}>{statusLabel(correction.status)}</td>
              <td style={{ padding: "0.5rem", whiteSpace: "nowrap" }}>
                <Link
                  href={`/workspaces/${workspaceId}/corrections/${correction.id}`}
                  style={{ marginRight: "0.5rem" }}
                >
                  Detail
                </Link>
                {canReview && correction.status === "PENDING" ? (
                  <>
                    <button
                      type="button"
                      data-testid={`approve-${correction.id}`}
                      onClick={() => open(correction, "approve")}
                      style={{ padding: "0.35rem 0.6rem", marginRight: "0.25rem" }}
                    >
                      Approve
                    </button>
                    <button
                      type="button"
                      data-testid={`reject-${correction.id}`}
                      onClick={() => open(correction, "reject")}
                      style={{ padding: "0.35rem 0.6rem" }}
                    >
                      Reject
                    </button>
                  </>
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {selected ? (
        <div
          role="dialog"
          aria-modal="true"
          data-testid="correction-review-dialog"
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.45)",
            display: "grid",
            placeItems: "center",
            padding: "1rem",
          }}
        >
          <div
            style={{
              background: "#fff",
              color: "#111",
              padding: "1.25rem",
              borderRadius: "0.5rem",
              width: "min(32rem, 100%)",
            }}
          >
            <h2 style={{ fontSize: "1.1rem", marginTop: 0 }}>
              {selected.action === "approve" ? "Setujui revisi?" : "Tolak revisi"}
            </h2>
            <p style={{ color: "#555", marginTop: 0 }}>
              {selected.correction.member.name} ·{" "}
              {typeLabel(selected.correction.requestType)} ·{" "}
              {stamp(selected.correction.requestedTimestamp)}
            </p>
            {selected.action === "approve" ? (
              <p>
                Absensi akan diperbarui dari{" "}
                <strong>{stamp(selected.correction.originalTimestamp)}</strong> menjadi{" "}
                <strong>{stamp(selected.correction.requestedTimestamp)}</strong>.
              </p>
            ) : (
              <label style={{ display: "grid", gap: "0.35rem" }}>
                Alasan penolakan (wajib, minimal {MIN_REJECTION_REASON} karakter)
                <textarea
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  rows={4}
                  disabled={busy}
                  style={{ padding: "0.5rem" }}
                />
              </label>
            )}
            {error ? (
              <p role="alert" style={{ color: "#b00020" }}>
                {error}
              </p>
            ) : null}
            <div style={{ display: "flex", gap: "0.5rem", justifyContent: "flex-end" }}>
              <button type="button" onClick={close} disabled={busy} style={{ padding: "0.5rem" }}>
                Batal
              </button>
              <button type="button" onClick={confirm} disabled={busy} style={{ padding: "0.5rem" }}>
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
