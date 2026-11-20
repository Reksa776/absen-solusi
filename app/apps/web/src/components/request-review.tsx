"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

const CSRF_COOKIE = "aos_csrf";

export type ReviewRequestRow = {
  id: string;
  memberName: string;
  date: string;
  status: string;
  reason: string;
  rejectionReason: string | null;
  startTime?: string;
  endTime?: string;
  durationMinutes?: number;
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

export function RequestReview({
  kind,
  rows,
  canReview,
}: {
  kind: "overtime" | "wfh";
  rows: ReviewRequestRow[];
  canReview: boolean;
}) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function review(id: string, action: "APPROVE" | "REJECT") {
    let rejectionReason: string | undefined;
    if (action === "REJECT") {
      const entered = window.prompt("Alasan penolakan (minimal 5 karakter)") ?? "";
      if (entered.trim().length < 5) {
        setError("Alasan penolakan minimal 5 karakter.");
        return;
      }
      rejectionReason = entered.trim();
    }
    setBusyId(id);
    setError(null);
    setNotice(null);
    try {
      const token = await csrfToken();
      const response = await fetch(`/api/${kind}/${id}`, {
        method: "PATCH",
        credentials: "same-origin",
        headers: { "content-type": "application/json", "x-csrf-token": token },
        body: JSON.stringify({ action, rejectionReason }),
      });
      const body = (await response.json().catch(() => ({}))) as {
        error?: { message?: string };
      };
      if (!response.ok) {
        setError(body.error?.message ?? "Review gagal.");
        return;
      }
      setNotice(action === "APPROVE" ? "Pengajuan disetujui." : "Pengajuan ditolak.");
      router.refresh();
    } catch {
      setError("Tidak dapat menghubungi server.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section>
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
      <div className="table-wrap">
        <div className="table-head">
          <div>
            <h2 className="section-title">
              {kind === "overtime" ? "Pengajuan lembur" : "Pengajuan WFH"}
            </h2>
            <p className="section-note">{rows.length} pengajuan</p>
          </div>
        </div>
        <div className="table-scroll">
          <table className="data">
            <thead>
              <tr>
                {["Member", "Tanggal", "Detail", "Alasan", "Status", "Aksi"].map((label) => (
                  <th key={label}>{label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={6} className="empty">
                    Tidak ada pengajuan.
                  </td>
                </tr>
              ) : null}
              {rows.map((row) => (
                <tr key={row.id}>
                  <td>
                    <span className="cell-title">{row.memberName}</span>
                  </td>
                  <td className="mono nowrap">{row.date}</td>
                  <td className="mono">
                    {kind === "overtime"
                      ? `${row.startTime}–${row.endTime} (${row.durationMinutes} menit)`
                      : "Remote / WFH"}
                  </td>
                  <td style={{ maxWidth: "18rem" }}>
                    {row.reason}
                    {row.rejectionReason ? (
                      <span className="cell-sub" style={{ color: "#991b1b" }}>
                        Ditolak: {row.rejectionReason}
                      </span>
                    ) : null}
                  </td>
                  <td>
                    <span className={statusBadge(row.status)}>{statusLabel(row.status)}</span>
                  </td>
                  <td className="nowrap">
                    {canReview && row.status === "PENDING" ? (
                      <div className="btn-row">
                        <button
                          type="button"
                          className="btn btn--primary btn--sm"
                          onClick={() => review(row.id, "APPROVE")}
                          disabled={busyId === row.id}
                        >
                          Setujui
                        </button>
                        <button
                          type="button"
                          className="btn btn--danger btn--sm"
                          onClick={() => review(row.id, "REJECT")}
                          disabled={busyId === row.id}
                        >
                          Tolak
                        </button>
                      </div>
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
    </section>
  );
}
