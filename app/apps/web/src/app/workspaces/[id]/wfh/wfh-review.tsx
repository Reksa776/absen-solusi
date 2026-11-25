"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

const CSRF_COOKIE = "aos_csrf";
const MIN_REJECTION_REASON = 5;

export type WfhReviewRow = {
  id: string;
  memberName: string;
  memberDivision: string | null;
  memberPosition: string | null;
  date: string;
  reason: string;
  status: string;
  rejectionReason: string | null;
};

const FILTERS = [
  { value: "PENDING", label: "Menunggu" },
  { value: "APPROVED", label: "Disetujui" },
  { value: "REJECTED", label: "Ditolak" },
  { value: "ALL", label: "Semua" },
] as const;

const DATE_FORMAT = new Intl.DateTimeFormat("id-ID", {
  weekday: "short",
  day: "2-digit",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

function formatDate(value: string): string {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) ? value : DATE_FORMAT.format(parsed);
}

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

export function WfhReview({
  workspaceId,
  rows,
  canReview,
}: {
  workspaceId: string;
  rows: WfhReviewRow[];
  canReview: boolean;
}) {
  const router = useRouter();
  const [filter, setFilter] = useState<(typeof FILTERS)[number]["value"]>("PENDING");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<WfhReviewRow | null>(null);
  const [rejectionReason, setRejectionReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const visible = useMemo(
    () => (filter === "ALL" ? rows : rows.filter((row) => row.status === filter)),
    [filter, rows],
  );

  async function review(
    row: WfhReviewRow,
    action: "APPROVE" | "REJECT",
    reason?: string,
  ) {
    setBusyId(row.id);
    setError(null);
    setNotice(null);
    try {
      const token = await csrfToken();
      const response = await fetch(
        `/api/workspaces/${workspaceId}/wfh/${row.id}/review`,
        {
          method: "POST",
          credentials: "same-origin",
          headers: { "content-type": "application/json", "x-csrf-token": token },
          body: JSON.stringify({ action, rejectionReason: reason }),
        },
      );
      const body = (await response.json().catch(() => ({}))) as {
        error?: { message?: string };
      };
      if (!response.ok) {
        setError(body.error?.message ?? "Review WFH gagal.");
        return;
      }
      setRejecting(null);
      setRejectionReason("");
      setNotice(
        action === "APPROVE"
          ? `WFH ${formatDate(row.date)} disetujui.`
          : `WFH ${formatDate(row.date)} ditolak.`,
      );
      router.refresh();
    } catch {
      setError("Tidak dapat menghubungi server.");
    } finally {
      setBusyId(null);
    }
  }

  function submitRejection() {
    if (!rejecting) return;
    const trimmed = rejectionReason.trim();
    if (trimmed.length < MIN_REJECTION_REASON) {
      setError(`Alasan penolakan minimal ${MIN_REJECTION_REASON} karakter.`);
      return;
    }
    void review(rejecting, "REJECT", trimmed);
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
            <h2 className="section-title">Daftar pengajuan WFH</h2>
            <p className="section-note">
              {visible.length} dari {rows.length} pengajuan pada filter ini
            </p>
          </div>
          <div className="chip-row" role="group" aria-label="Filter status WFH">
            {FILTERS.map((item) => (
              <button
                key={item.value}
                type="button"
                className={`chip${filter === item.value ? " chip--active" : ""}`}
                aria-pressed={filter === item.value}
                onClick={() => setFilter(item.value)}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>
        <div className="table-scroll">
          <table className="data">
            <thead>
              <tr>
                {["Karyawan", "Tanggal WFH", "Alasan", "Status", "Aksi"].map((label) => (
                  <th key={label}>{label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visible.length === 0 ? (
                <tr>
                  <td colSpan={5} className="empty">
                    Tidak ada pengajuan WFH pada filter ini.
                  </td>
                </tr>
              ) : null}
              {visible.map((row) => (
                <tr key={row.id}>
                  <td>
                    <span className="cell-title">{row.memberName}</span>
                    <span className="cell-sub">
                      {[row.memberDivision, row.memberPosition]
                        .filter(Boolean)
                        .join(" · ") || "—"}
                    </span>
                  </td>
                  <td className="mono nowrap">{formatDate(row.date)}</td>
                  <td style={{ maxWidth: "20rem" }}>
                    {row.reason}
                    {row.rejectionReason ? (
                      <span className="cell-sub text-danger">
                        Ditolak: {row.rejectionReason}
                      </span>
                    ) : null}
                  </td>
                  <td>
                    <span className={statusBadge(row.status)}>
                      {statusLabel(row.status)}
                    </span>
                  </td>
                  <td className="nowrap">
                    {canReview && row.status === "PENDING" ? (
                      <div className="btn-row">
                        <button
                          type="button"
                          className="btn btn--primary btn--sm"
                          disabled={busyId === row.id}
                          onClick={() => void review(row, "APPROVE")}
                        >
                          Setujui
                        </button>
                        <button
                          type="button"
                          className="btn btn--danger btn--sm"
                          disabled={busyId === row.id}
                          onClick={() => {
                            setError(null);
                            setNotice(null);
                            setRejectionReason("");
                            setRejecting(row);
                          }}
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

      {rejecting ? (
        <div className="modal-backdrop" role="presentation">
          <div
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="wfh-reject-title"
          >
            <h2 id="wfh-reject-title">Tolak pengajuan WFH</h2>
            <p className="modal-sub">
              {rejecting.memberName} · {formatDate(rejecting.date)}
            </p>
            <label className="field">
              Catatan penolakan (wajib, minimal {MIN_REJECTION_REASON} karakter)
              <textarea
                rows={3}
                value={rejectionReason}
                onChange={(event) => setRejectionReason(event.target.value)}
                placeholder="Jelaskan alasan penolakan agar karyawan dapat memperbaiki pengajuannya."
              />
            </label>
            <div className="modal-actions">
              <button
                type="button"
                className="btn btn--secondary"
                onClick={() => setRejecting(null)}
                disabled={busyId === rejecting.id}
              >
                Batal
              </button>
              <button
                type="button"
                className="btn btn--danger"
                onClick={submitRejection}
                disabled={busyId === rejecting.id}
              >
                {busyId === rejecting.id ? "Memproses..." : "Tolak pengajuan"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
