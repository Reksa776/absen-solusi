"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

const CSRF_COOKIE = "aos_csrf";

type Attendance = {
  id: string;
  memberName: string;
  memberEmail: string;
  divisionName: string | null;
  type: string;
  workDate: string;
  timestampServer: string;
  latitude: number;
  longitude: number;
  distanceMeters: number;
  officeName: string | null;
  reason: string | null;
  approvalStatus: string;
  currentApprovalLevel: number;
  rejectionReason: string | null;
  photoUrl: string;
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
  if (status === "PENDING") return "badge badge--yellow";
  return "badge badge--red";
}

function statusLabel(status: string) {
  if (status === "APPROVED") return "Disetujui";
  if (status === "PENDING") return "Menunggu";
  return "Ditolak";
}

export function OutOfTownReview({
  workspaceId,
  pending,
  all,
}: {
  workspaceId: string;
  pending: Attendance[];
  all: Attendance[];
}) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const reviewed = all.filter((row) => row.approvalStatus !== "PENDING");

  async function act(row: Attendance, action: "APPROVE" | "REJECT", note = "") {
    setBusyId(row.id);
    setError(null);
    setNotice(null);
    try {
      const token = await csrfToken();
      const response = await fetch(
        `/api/workspaces/${workspaceId}/attendance/${row.id}/review`,
        {
          method: "PATCH",
          credentials: "same-origin",
          headers: { "content-type": "application/json", "x-csrf-token": token },
          body: JSON.stringify({ action, rejectionReason: note }),
        },
      );
      const body = (await response.json().catch(() => ({}))) as {
        error?: { message?: string };
        approvalStatus?: string;
      };
      if (!response.ok) {
        setError(body.error?.message ?? "Presensi gagal direview.");
        return;
      }
      setNotice(
        body.approvalStatus === "PENDING"
          ? "Disetujui pada level ini dan diteruskan ke approver berikutnya."
          : action === "APPROVE"
            ? `Presensi ${row.memberName} disetujui.`
            : `Presensi ${row.memberName} ditolak.`,
      );
      setRejectingId(null);
      setReason("");
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
            <h2 className="section-title">Menunggu persetujuan</h2>
            <p className="section-note">
              Approve pertama mengikuti level 1 alur persetujuan bila sudah diatur.
            </p>
          </div>
        </div>
        <div className="table-scroll">
          <table className="data">
            <thead>
              <tr>
                <th>Karyawan</th>
                <th>Waktu</th>
                <th>Lokasi</th>
                <th>Alasan dinas</th>
                <th>Level</th>
                <th>Foto</th>
                <th>Aksi</th>
              </tr>
            </thead>
            <tbody>
              {pending.length === 0 ? (
                <tr>
                  <td colSpan={7} className="empty">
                    Tidak ada presensi luar kota yang menunggu.
                  </td>
                </tr>
              ) : null}
              {pending.map((row) => (
                <tr key={row.id}>
                  <td>
                    <span className="cell-title">{row.memberName}</span>
                    <span className="cell-sub">
                      {row.divisionName ?? "Tanpa divisi"} · {row.memberEmail}
                    </span>
                  </td>
                  <td>
                    <span className="cell-title">
                      {row.type === "CHECK_IN" ? "Check-in" : "Check-out"}
                    </span>
                    <span className="cell-sub mono">
                      {new Date(row.timestampServer).toLocaleString("id-ID")}
                    </span>
                  </td>
                  <td>
                    <span className="cell-title">
                      {row.distanceMeters.toFixed(0)} m dari kantor
                    </span>
                    <span className="cell-sub">
                      {row.officeName ?? "Tanpa kantor"} · {row.latitude.toFixed(5)},{" "}
                      {row.longitude.toFixed(5)}
                    </span>
                  </td>
                  <td className="muted" style={{ maxWidth: "18rem" }}>
                    {row.reason ?? "—"}
                  </td>
                  <td className="num">{row.currentApprovalLevel + 1}</td>
                  <td>
                    <a
                      className="btn btn--secondary btn--sm"
                      href={row.photoUrl}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Lihat foto
                    </a>
                  </td>
                  <td>
                    {rejectingId === row.id ? (
                      <div className="stack" style={{ minWidth: "15rem" }}>
                        <textarea
                          className="select-inline"
                          style={{ maxWidth: "100%", minHeight: "4rem" }}
                          minLength={5}
                          maxLength={500}
                          value={reason}
                          onChange={(event) => setReason(event.target.value)}
                          placeholder="Alasan penolakan (5–500 karakter)"
                          aria-label="Alasan penolakan presensi"
                        />
                        <div className="btn-row">
                          <button
                            type="button"
                            className="btn btn--danger btn--sm"
                            disabled={busyId === row.id || reason.trim().length < 5}
                            onClick={() => act(row, "REJECT", reason.trim())}
                          >
                            Kirim
                          </button>
                          <button
                            type="button"
                            className="btn btn--secondary btn--sm"
                            onClick={() => {
                              setRejectingId(null);
                              setReason("");
                            }}
                          >
                            Batal
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="btn-row">
                        <button
                          type="button"
                          className="btn btn--primary btn--sm"
                          disabled={busyId === row.id}
                          onClick={() => act(row, "APPROVE")}
                        >
                          Setujui
                        </button>
                        <button
                          type="button"
                          className="btn btn--danger btn--sm"
                          disabled={busyId === row.id}
                          onClick={() => {
                            setRejectingId(row.id);
                            setReason("");
                          }}
                        >
                          Tolak
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="table-wrap">
        <div className="table-head">
          <div>
            <h2 className="section-title">Riwayat review</h2>
            <p className="section-note">
              <span className="num">{reviewed.length}</span> presensi sudah diproses
            </p>
          </div>
        </div>
        <div className="table-scroll">
          <table className="data">
            <thead>
              <tr>
                <th>Karyawan</th>
                <th>Tanggal kerja</th>
                <th>Jarak</th>
                <th>Status</th>
                <th>Catatan</th>
              </tr>
            </thead>
            <tbody>
              {reviewed.length === 0 ? (
                <tr>
                  <td colSpan={5} className="empty">
                    Belum ada riwayat review.
                  </td>
                </tr>
              ) : null}
              {reviewed.map((row) => (
                <tr key={row.id}>
                  <td>
                    <span className="cell-title">{row.memberName}</span>
                    <span className="cell-sub">{row.memberEmail}</span>
                  </td>
                  <td className="mono">{row.workDate}</td>
                  <td className="num">{row.distanceMeters.toFixed(0)} m</td>
                  <td>
                    <span className={statusBadge(row.approvalStatus)}>
                      {statusLabel(row.approvalStatus)}
                    </span>
                  </td>
                  <td className="muted">{row.rejectionReason ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
