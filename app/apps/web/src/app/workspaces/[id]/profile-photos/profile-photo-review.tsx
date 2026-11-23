"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

const CSRF_COOKIE = "aos_csrf";

type Photo = {
  memberId: string;
  memberName: string;
  memberEmail: string;
  divisionName: string | null;
  positionName: string | null;
  photoUrl: string | null;
  photoStatus: string;
  photoSubmittedAt: string | null;
  photoReviewedAt: string | null;
  photoRejectionReason: string | null;
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

export function ProfilePhotoReview({
  workspaceId,
  pending,
  reviewed,
}: {
  workspaceId: string;
  pending: Photo[];
  reviewed: Photo[];
}) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function act(photo: Photo, action: "APPROVE" | "REJECT", rejectionReason = "") {
    setBusyId(photo.memberId);
    setError(null);
    setNotice(null);
    try {
      const token = await csrfToken();
      const response = await fetch(
        `/api/workspaces/${workspaceId}/profile-photos/${photo.memberId}`,
        {
          method: "PATCH",
          credentials: "same-origin",
          headers: { "content-type": "application/json", "x-csrf-token": token },
          body: JSON.stringify({ action, rejectionReason }),
        },
      );
      const body = (await response.json().catch(() => ({}))) as {
        error?: { message?: string };
      };
      if (!response.ok) {
        setError(body.error?.message ?? "Foto gagal direview.");
        return;
      }
      setNotice(
        action === "APPROVE"
          ? `Foto ${photo.memberName} disetujui.`
          : `Foto ${photo.memberName} ditolak.`,
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
              <span className="num">{pending.length}</span> foto perlu diverifikasi
            </p>
          </div>
        </div>
        {pending.length === 0 ? (
          <p className="empty">Tidak ada foto yang menunggu persetujuan.</p>
        ) : (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(15rem, 1fr))",
              gap: "0.75rem",
              padding: "1rem",
            }}
          >
            {pending.map((photo) => (
              <article key={photo.memberId} className="card">
                <img
                  src={`/api/workspaces/${workspaceId}/members/${photo.memberId}/photo`}
                  alt={`Foto ${photo.memberName}`}
                  style={{
                    width: "100%",
                    aspectRatio: "1 / 1",
                    objectFit: "cover",
                    borderRadius: "12px 12px 0 0",
                    borderBottom: "1px solid var(--line)",
                    display: "block",
                  }}
                />
                <div className="card-pad">
                  <strong className="cell-title">{photo.memberName}</strong>
                  <span className="cell-sub">{photo.memberEmail}</span>
                  <p className="section-note" style={{ marginTop: "0.45rem" }}>
                    {photo.divisionName ?? "Tanpa divisi"} ·{" "}
                    {photo.positionName ?? "Tanpa jabatan"}
                  </p>
                  {photo.photoSubmittedAt ? (
                    <p className="mono" style={{ margin: "0.35rem 0 0" }}>
                      Diunggah {new Date(photo.photoSubmittedAt).toLocaleString("id-ID")}
                    </p>
                  ) : null}
                  {rejectingId === photo.memberId ? (
                    <div className="stack" style={{ marginTop: "0.7rem" }}>
                      <label className="field">
                        Alasan penolakan
                        <textarea
                          minLength={5}
                          maxLength={500}
                          value={reason}
                          onChange={(event) => setReason(event.target.value)}
                          placeholder="Contoh: wajah tidak jelas atau foto bukan baseline."
                        />
                      </label>
                      <div className="btn-row">
                        <button
                          type="button"
                          className="btn btn--danger btn--sm"
                          disabled={busyId === photo.memberId || reason.trim().length < 5}
                          onClick={() => act(photo, "REJECT", reason.trim())}
                        >
                          Kirim penolakan
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
                    <div className="btn-row" style={{ marginTop: "0.7rem" }}>
                      <button
                        type="button"
                        className="btn btn--primary btn--sm"
                        disabled={busyId === photo.memberId}
                        onClick={() => act(photo, "APPROVE")}
                      >
                        Setujui
                      </button>
                      <button
                        type="button"
                        className="btn btn--danger btn--sm"
                        disabled={busyId === photo.memberId}
                        onClick={() => {
                          setRejectingId(photo.memberId);
                          setReason("");
                        }}
                      >
                        Tolak
                      </button>
                    </div>
                  )}
                </div>
              </article>
            ))}
          </div>
        )}
      </div>

      <div className="table-wrap">
        <div className="table-head">
          <div>
            <h2 className="section-title">Riwayat review</h2>
            <p className="section-note">
              <span className="num">{reviewed.length}</span> foto sudah diproses
            </p>
          </div>
        </div>
        <div className="table-scroll">
          <table className="data">
            <thead>
              <tr>
                <th>Karyawan</th>
                <th>Divisi</th>
                <th>Status</th>
                <th>Direview</th>
                <th>Catatan</th>
              </tr>
            </thead>
            <tbody>
              {reviewed.length === 0 ? (
                <tr>
                  <td colSpan={5} className="empty">
                    Belum ada riwayat review foto.
                  </td>
                </tr>
              ) : null}
              {reviewed.map((photo) => (
                <tr key={photo.memberId}>
                  <td>
                    <span className="cell-title">{photo.memberName}</span>
                    <span className="cell-sub">{photo.memberEmail}</span>
                  </td>
                  <td>{photo.divisionName ?? "—"}</td>
                  <td>
                    <span
                      className={
                        photo.photoStatus === "APPROVED"
                          ? "badge badge--green"
                          : "badge badge--red"
                      }
                    >
                      {photo.photoStatus === "APPROVED" ? "Disetujui" : "Ditolak"}
                    </span>
                  </td>
                  <td className="mono">
                    {photo.photoReviewedAt
                      ? new Date(photo.photoReviewedAt).toLocaleString("id-ID")
                      : "—"}
                  </td>
                  <td className="muted">{photo.photoRejectionReason ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
