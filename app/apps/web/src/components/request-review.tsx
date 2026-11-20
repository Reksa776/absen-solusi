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
      {error ? <p role="alert" style={{ color: "#b00020" }}>{error}</p> : null}
      {notice ? <p role="status">{notice}</p> : null}
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.9rem" }}>
        <thead>
          <tr>
            {["Member", "Tanggal", "Detail", "Alasan", "Status", "Aksi"].map((label) => (
              <th key={label} style={{ textAlign: "left", borderBottom: "1px solid #ccc", padding: "0.5rem" }}>
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={6} style={{ padding: "0.75rem", color: "#555" }}>
                Tidak ada pengajuan.
              </td>
            </tr>
          ) : null}
          {rows.map((row) => (
            <tr key={row.id}>
              <td style={{ padding: "0.5rem" }}>{row.memberName}</td>
              <td style={{ padding: "0.5rem" }}>{row.date}</td>
              <td style={{ padding: "0.5rem" }}>
                {kind === "overtime"
                  ? `${row.startTime}–${row.endTime} (${row.durationMinutes} menit)`
                  : "Remote / WFH"}
              </td>
              <td style={{ padding: "0.5rem", maxWidth: "18rem" }}>
                {row.reason}
                {row.rejectionReason ? (
                  <div style={{ color: "#b00020", fontSize: "0.8rem" }}>
                    Ditolak: {row.rejectionReason}
                  </div>
                ) : null}
              </td>
              <td style={{ padding: "0.5rem" }}>{row.status}</td>
              <td style={{ padding: "0.5rem", whiteSpace: "nowrap" }}>
                {canReview && row.status === "PENDING" ? (
                  <>
                    <button
                      type="button"
                      onClick={() => review(row.id, "APPROVE")}
                      disabled={busyId === row.id}
                      style={{ padding: "0.35rem 0.6rem", marginRight: "0.25rem" }}
                    >
                      Setujui
                    </button>
                    <button
                      type="button"
                      onClick={() => review(row.id, "REJECT")}
                      disabled={busyId === row.id}
                      style={{ padding: "0.35rem 0.6rem" }}
                    >
                      Tolak
                    </button>
                  </>
                ) : "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
