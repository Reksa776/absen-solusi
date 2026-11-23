"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { sendJson } from "@/lib/browser-api";

type AttendanceSetting = {
  defaultLateToleranceMinutes: number;
  earliestCheckInMinutes: number;
  maxCheckOutMinutes: number;
  requireSelfie: boolean;
  gpsRadiusPolicy: string;
};

const POLICY_LABELS: Record<string, string> = {
  STRICT: "Tolak di luar radius",
  FLAG: "Catat dan minta persetujuan",
  OFF: "Abaikan validasi radius",
};

export function AttendanceSettingsForm({
  workspaceId,
  setting,
  canManage,
}: {
  workspaceId: string;
  setting: AttendanceSetting;
  canManage: boolean;
}) {
  const router = useRouter();
  const [form, setForm] = useState(setting);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await sendJson(`/api/workspaces/${workspaceId}/attendance/settings`, "PATCH", form);
      setNotice("Pengaturan kehadiran disimpan.");
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Pengaturan gagal disimpan.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="form-card">
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
          Toleransi terlambat default (menit)
          <input
            type="number"
            min={0}
            max={180}
            required
            className="mono"
            value={form.defaultLateToleranceMinutes}
            disabled={!canManage}
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                defaultLateToleranceMinutes: Number(event.target.value),
              }))
            }
          />
        </label>
        <label className="field">
          Batas awal check-in (menit sebelum jam kerja)
          <input
            type="number"
            min={0}
            max={720}
            required
            className="mono"
            value={form.earliestCheckInMinutes}
            disabled={!canManage}
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                earliestCheckInMinutes: Number(event.target.value),
              }))
            }
          />
        </label>
        <label className="field">
          Batas check-out (menit setelah jam kerja)
          <input
            type="number"
            min={0}
            max={1440}
            required
            className="mono"
            value={form.maxCheckOutMinutes}
            disabled={!canManage}
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                maxCheckOutMinutes: Number(event.target.value),
              }))
            }
          />
        </label>
        <label className="field">
          Validasi radius GPS
          <select
            value={form.gpsRadiusPolicy}
            disabled={!canManage}
            onChange={(event) =>
              setForm((current) => ({ ...current, gpsRadiusPolicy: event.target.value }))
            }
          >
            {Object.entries(POLICY_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="field--check">
          <input
            type="checkbox"
            checked={form.requireSelfie}
            disabled={!canManage}
            onChange={(event) =>
              setForm((current) => ({ ...current, requireSelfie: event.target.checked }))
            }
          />
          Wajib selfie untuk presensi
        </label>
      </div>
      <p className="field-hint" style={{ marginTop: "0.65rem" }}>
        Kebijakan radius FLAG mencatat presensi di luar radius dan memasukkannya ke antrean
        persetujuan. STRICT menolak, OFF hanya menyimpan jarak untuk audit.
      </p>
      {canManage ? (
        <div className="btn-row" style={{ marginTop: "0.9rem" }}>
          <button type="submit" className="btn btn--primary" disabled={busy}>
            {busy ? "Menyimpan..." : "Simpan pengaturan"}
          </button>
        </div>
      ) : null}
    </form>
  );
}

export type AttendanceApprovalRow = {
  id: string;
  memberId: string;
  memberName: string;
  memberEmail: string;
  divisionName: string | null;
  type: string;
  workDate: string;
  timestampServer: string;
  distanceMeters: number;
  workMode: string;
  outOfRadius: boolean;
  outOfTownReason: string | null;
  photoUrl: string;
};

export function AttendanceApprovalQueue({
  workspaceId,
  rows,
}: {
  workspaceId: string;
  rows: AttendanceApprovalRow[];
}) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function review(row: AttendanceApprovalRow, action: "APPROVE" | "REJECT") {
    let rejectionReason: string | undefined;
    if (action === "REJECT") {
      const input = window.prompt("Alasan penolakan (minimal 5 karakter):");
      if (!input) return;
      rejectionReason = input;
    }
    setBusyId(row.id);
    setError(null);
    try {
      await sendJson(
        `/api/workspaces/${workspaceId}/attendance/approvals/${row.id}`,
        "PATCH",
        { action, rejectionReason },
      );
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Presensi gagal direview.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div>
      {error ? (
        <p role="alert" className="alert">
          {error}
        </p>
      ) : null}
      <div className="table-wrap">
        <div className="table-scroll">
          <table className="data">
            <thead>
              <tr>
                {["Karyawan", "Presensi", "Lokasi", "Alasan", "Bukti", "Aksi"].map((label) => (
                  <th key={label}>{label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={6} className="empty">
                    Tidak ada presensi yang menunggu persetujuan.
                  </td>
                </tr>
              ) : null}
              {rows.map((row) => (
                <tr key={row.id}>
                  <td>
                    <span className="cell-title">{row.memberName}</span>
                    <span className="cell-sub">
                      {row.divisionName ?? row.memberEmail}
                    </span>
                  </td>
                  <td>
                    <span className="cell-title">{row.type === "CHECK_IN" ? "Masuk" : "Pulang"}</span>
                    <span className="cell-sub mono">{row.workDate}</span>
                  </td>
                  <td>
                    <span className="cell-title">
                      {row.workMode === "OUT_OF_TOWN"
                        ? "Dinas luar kota"
                        : row.outOfRadius
                          ? "Luar radius"
                          : "Dalam radius"}
                    </span>
                    <span className="cell-sub mono">{Math.round(row.distanceMeters)} m</span>
                  </td>
                  <td className="muted">{row.outOfTownReason ?? "—"}</td>
                  <td>
                    <Link href={row.photoUrl} target="_blank" rel="noreferrer">
                      Lihat foto
                    </Link>
                  </td>
                  <td>
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
