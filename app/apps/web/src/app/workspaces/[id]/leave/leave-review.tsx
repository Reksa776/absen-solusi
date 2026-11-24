"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

const CSRF_COOKIE = "aos_csrf";
const TYPE_LABELS: Record<string, string> = {
  CUTI_TAHUNAN: "Cuti tahunan",
  CUTI_MELAHIRKAN: "Cuti melahirkan",
  CUTI_KHUSUS: "Cuti khusus",
  LAINNYA: "Lainnya",
};

type LeaveRow = {
  id: string;
  memberName: string;
  divisionName: string | null;
  leaveType: string;
  startDate: string;
  endDate: string;
  workingDays: number;
  reason: string;
  status: string;
  currentApprovalLevel: number;
  rejectionReason: string | null;
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

function statusBadge(status: string) {
  if (status === "APPROVED") return "badge badge--green";
  if (status === "REJECTED") return "badge badge--red";
  return "badge badge--yellow";
}

function statusLabel(status: string) {
  if (status === "APPROVED") return "Disetujui";
  if (status === "REJECTED") return "Ditolak";
  return "Menunggu";
}

export function LeaveReview({
  rows,
  canReview,
}: {
  rows: LeaveRow[];
  canReview: boolean;
}) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function review(row: LeaveRow, action: "APPROVE" | "REJECT") {
    let rejectionReason: string | undefined;
    if (action === "REJECT") {
      const entered = window.prompt("Alasan penolakan (minimal 5 karakter)") ?? "";
      if (entered.trim().length < 5) {
        setError("Alasan penolakan minimal 5 karakter.");
        return;
      }
      rejectionReason = entered.trim();
    }
    setBusyId(row.id);
    setError(null);
    setNotice(null);
    try {
      const token = await csrfToken();
      const response = await fetch(`/api/leave/${row.id}`, {
        method: "PATCH",
        credentials: "same-origin",
        headers: { "content-type": "application/json", "x-csrf-token": token },
        body: JSON.stringify({ action, rejectionReason }),
      });
      const body = (await response.json().catch(() => ({}))) as {
        status?: string;
        error?: { message?: string };
      };
      if (!response.ok) {
        setError(body.error?.message ?? "Review cuti gagal.");
        return;
      }
      setNotice(
        action === "REJECT"
          ? "Pengajuan cuti ditolak."
          : body.status === "PENDING"
            ? "Disetujui pada level ini; diteruskan ke approver berikutnya."
            : "Cuti disetujui; saldo tahunan telah dipotong.",
      );
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
            <h2 className="section-title">Permohonan cuti</h2>
            <p className="section-note">
              <span className="num">{rows.length}</span> pengajuan pada filter ini
            </p>
          </div>
        </div>
        <div className="table-scroll">
          <table className="data">
            <thead>
              <tr>
                <th>Karyawan</th>
                <th>Jenis</th>
                <th>Tanggal</th>
                <th>Hari kerja</th>
                <th>Alasan</th>
                <th>Status</th>
                <th>Aksi</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={7} className="empty">
                    Tidak ada pengajuan cuti.
                  </td>
                </tr>
              ) : null}
              {rows.map((row) => (
                <tr key={row.id}>
                  <td>
                    <span className="cell-title">{row.memberName}</span>
                    <span className="cell-sub">{row.divisionName ?? "Tanpa divisi"}</span>
                  </td>
                  <td>{TYPE_LABELS[row.leaveType] ?? row.leaveType}</td>
                  <td className="mono nowrap">
                    {row.startDate}
                    {row.endDate !== row.startDate ? ` – ${row.endDate}` : ""}
                  </td>
                  <td className="num">{row.workingDays}</td>
                  <td style={{ maxWidth: "18rem" }}>
                    {row.reason}
                    {row.rejectionReason ? (
                      <span className="cell-sub text-danger">
                        Ditolak: {row.rejectionReason}
                      </span>
                    ) : null}
                  </td>
                  <td>
                    <span className={statusBadge(row.status)}>{statusLabel(row.status)}</span>
                    {row.status === "PENDING" && row.currentApprovalLevel > 0 ? (
                      <span className="cell-sub">Level {row.currentApprovalLevel + 1}</span>
                    ) : null}
                  </td>
                  <td className="nowrap">
                    {canReview && row.status === "PENDING" ? (
                      <div className="btn-row">
                        <button
                          type="button"
                          className="btn btn--primary btn--sm"
                          disabled={busyId === row.id}
                          onClick={() => review(row, "APPROVE")}
                        >
                          Setujui
                        </button>
                        <button
                          type="button"
                          className="btn btn--danger btn--sm"
                          disabled={busyId === row.id}
                          onClick={() => review(row, "REJECT")}
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
