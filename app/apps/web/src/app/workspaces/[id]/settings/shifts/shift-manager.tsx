"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

const CSRF_COOKIE = "aos_csrf";

type Shift = {
  id: string;
  name: string;
  startTime: string;
  endTime: string;
  lateToleranceMinutes: number;
  isOvernight: boolean;
  isActive: boolean;
};

type Assignment = {
  id: string;
  memberId: string;
  memberName: string;
  shiftName: string;
  workDate: string | null;
};

type Member = { id: string; name: string };

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

export function ShiftManager({
  workspaceId,
  shifts,
  assignments,
  members,
}: {
  workspaceId: string;
  shifts: Shift[];
  assignments: Assignment[];
  members: Member[];
}) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [startTime, setStartTime] = useState("09:00");
  const [endTime, setEndTime] = useState("17:00");
  const [tolerance, setTolerance] = useState("15");
  const [memberId, setMemberId] = useState(members[0]?.id ?? "");
  const [shiftId, setShiftId] = useState(shifts[0]?.id ?? "");
  const [workDate, setWorkDate] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function send(url: string, method: "POST" | "PATCH" | "DELETE", payload?: unknown) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const token = await csrfToken();
      const response = await fetch(url, {
        method,
        credentials: "same-origin",
        headers: {
          ...(payload === undefined ? {} : { "content-type": "application/json" }),
          "x-csrf-token": token,
        },
        ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
      });
      const body = (await response.json().catch(() => ({}))) as {
        error?: { message?: string };
      };
      if (!response.ok) {
        setError(body.error?.message ?? "Permintaan gagal");
        return false;
      }
      return true;
    } catch {
      setError("Tidak dapat menghubungi server");
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const ok = await send(`/api/workspaces/${workspaceId}/shifts`, "POST", {
      name,
      startTime,
      endTime,
      lateToleranceMinutes: Number(tolerance),
    });
    if (ok) {
      setName("");
      setNotice("Shift dibuat.");
      router.refresh();
    }
  }

  async function assign(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const ok = await send(
      `/api/workspaces/${workspaceId}/shift-assignments`,
      "POST",
      { memberId, shiftId, workDate: workDate || null },
    );
    if (ok) {
      setWorkDate("");
      setNotice("Penugasan shift disimpan.");
      router.refresh();
    }
  }

  async function deactivate(id: string) {
    const ok = await send(
      `/api/workspaces/${workspaceId}/shifts/${id}`,
      "DELETE",
    );
    if (ok) {
      setNotice("Shift dinonaktifkan.");
      router.refresh();
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

      <div className="form-card">
        <h2 className="section-title">Daftar shift</h2>
        <p className="section-note" style={{ marginBottom: "0.75rem" }}>
          Tambahkan shift baru atau nonaktifkan yang tidak dipakai.
        </p>
        <form onSubmit={create} className="form-row">
          <label className="field" style={{ flex: "1 1 12rem" }}>
            Nama
            <input
              required
              maxLength={120}
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Pagi"
            />
          </label>
          <label className="field">
            Masuk
            <input
              type="time"
              required
              className="mono"
              value={startTime}
              onChange={(event) => setStartTime(event.target.value)}
            />
          </label>
          <label className="field">
            Pulang
            <input
              type="time"
              required
              className="mono"
              value={endTime}
              onChange={(event) => setEndTime(event.target.value)}
            />
          </label>
          <label className="field">
            Toleransi (menit)
            <input
              type="number"
              min={0}
              max={120}
              required
              className="mono"
              value={tolerance}
              onChange={(event) => setTolerance(event.target.value)}
            />
          </label>
          <button type="submit" className="btn btn--primary" disabled={busy}>
            {busy ? "Memproses…" : "Tambah shift"}
          </button>
        </form>
      </div>

      <div className="table-wrap">
        <div className="table-head">
          <div>
            <h2 className="section-title">Shift terdaftar</h2>
            <p className="section-note">{shifts.length} shift</p>
          </div>
        </div>
        <div className="table-scroll">
          <table className="data">
            <thead>
              <tr>
                {["Nama", "Jam", "Toleransi", "Status", "Aksi"].map((label) => (
                  <th key={label}>{label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {shifts.length === 0 ? (
                <tr>
                  <td colSpan={5} className="empty">
                    Belum ada shift.
                  </td>
                </tr>
              ) : null}
              {shifts.map((shift) => (
                <tr key={shift.id}>
                  <td>
                    <span className="cell-title">{shift.name}</span>
                  </td>
                  <td className="mono nowrap">
                    {shift.startTime}–{shift.endTime}
                    {shift.isOvernight ? " (lintas hari)" : ""}
                  </td>
                  <td className="num">{shift.lateToleranceMinutes} menit</td>
                  <td>
                    <span className={shift.isActive ? "badge badge--green" : "badge badge--neutral"}>
                      {shift.isActive ? "Aktif" : "Nonaktif"}
                    </span>
                  </td>
                  <td>
                    {shift.isActive ? (
                      <button
                        type="button"
                        className="btn btn--danger btn--sm"
                        onClick={() => deactivate(shift.id)}
                        disabled={busy}
                      >
                        Nonaktifkan
                      </button>
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

      <div className="form-card" style={{ marginTop: "1.25rem" }}>
        <h2 className="section-title">Penugasan shift</h2>
        <p className="section-note" style={{ marginBottom: "0.75rem" }}>
          Tanpa tanggal berarti penugasan default untuk karyawan tersebut.
        </p>
        <form onSubmit={assign} className="form-row">
          <label className="field" style={{ flex: "1 1 12rem" }}>
            Member
            <select value={memberId} onChange={(event) => setMemberId(event.target.value)}>
              {members.map((member) => (
                <option key={member.id} value={member.id}>
                  {member.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field" style={{ flex: "1 1 10rem" }}>
            Shift
            <select value={shiftId} onChange={(event) => setShiftId(event.target.value)}>
              {shifts
                .filter((shift) => shift.isActive)
                .map((shift) => (
                  <option key={shift.id} value={shift.id}>
                    {shift.name}
                  </option>
                ))}
            </select>
          </label>
          <label className="field">
            Tanggal (kosong = default)
            <input
              type="date"
              value={workDate}
              onChange={(event) => setWorkDate(event.target.value)}
            />
          </label>
          <button
            type="submit"
            className="btn btn--primary"
            disabled={busy || !memberId || !shiftId}
          >
            Simpan penugasan
          </button>
        </form>
      </div>

      <div className="table-wrap">
        <div className="table-head">
          <div>
            <h2 className="section-title">Penugasan aktif</h2>
            <p className="section-note">{assignments.length} penugasan</p>
          </div>
        </div>
        <div className="table-scroll">
          <table className="data">
            <thead>
              <tr>
                {["Member", "Shift", "Tanggal", "Jenis"].map((label) => (
                  <th key={label}>{label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {assignments.length === 0 ? (
                <tr>
                  <td colSpan={4} className="empty">
                    Belum ada penugasan.
                  </td>
                </tr>
              ) : null}
              {assignments.map((assignment) => (
                <tr key={assignment.id}>
                  <td>
                    <span className="cell-title">{assignment.memberName}</span>
                  </td>
                  <td>{assignment.shiftName}</td>
                  <td className="mono nowrap">{assignment.workDate ?? "—"}</td>
                  <td>
                    <span className="badge badge--neutral">
                      {assignment.workDate ? "Per tanggal" : "Default"}
                    </span>
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
