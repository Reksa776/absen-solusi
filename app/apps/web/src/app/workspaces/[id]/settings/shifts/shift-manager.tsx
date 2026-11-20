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
      {error ? <p role="alert" style={{ color: "#b00020" }}>{error}</p> : null}
      {notice ? <p role="status">{notice}</p> : null}

      <h2 style={{ fontSize: "1.1rem" }}>Daftar shift</h2>
      <form
        onSubmit={create}
        style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", alignItems: "end" }}
      >
        <label style={{ display: "grid", gap: "0.25rem" }}>
          Nama
          <input
            required
            maxLength={120}
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Pagi"
            style={{ padding: "0.5rem" }}
          />
        </label>
        <label style={{ display: "grid", gap: "0.25rem" }}>
          Masuk
          <input
            type="time"
            required
            value={startTime}
            onChange={(event) => setStartTime(event.target.value)}
            style={{ padding: "0.5rem" }}
          />
        </label>
        <label style={{ display: "grid", gap: "0.25rem" }}>
          Pulang
          <input
            type="time"
            required
            value={endTime}
            onChange={(event) => setEndTime(event.target.value)}
            style={{ padding: "0.5rem" }}
          />
        </label>
        <label style={{ display: "grid", gap: "0.25rem" }}>
          Toleransi (menit)
          <input
            type="number"
            min={0}
            max={120}
            required
            value={tolerance}
            onChange={(event) => setTolerance(event.target.value)}
            style={{ padding: "0.5rem" }}
          />
        </label>
        <button type="submit" disabled={busy} style={{ padding: "0.6rem" }}>
          {busy ? "Memproses…" : "Tambah shift"}
        </button>
      </form>

      <table style={{ width: "100%", borderCollapse: "collapse", marginTop: "1rem" }}>
        <thead>
          <tr>
            {["Nama", "Jam", "Toleransi", "Status", "Aksi"].map((label) => (
              <th key={label} style={{ textAlign: "left", borderBottom: "1px solid #ccc", padding: "0.5rem" }}>
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {shifts.length === 0 ? (
            <tr><td colSpan={5} style={{ padding: "0.75rem", color: "#555" }}>Belum ada shift.</td></tr>
          ) : null}
          {shifts.map((shift) => (
            <tr key={shift.id}>
              <td style={{ padding: "0.5rem" }}>{shift.name}</td>
              <td style={{ padding: "0.5rem" }}>
                {shift.startTime}–{shift.endTime}
                {shift.isOvernight ? " (lintas hari)" : ""}
              </td>
              <td style={{ padding: "0.5rem" }}>{shift.lateToleranceMinutes} menit</td>
              <td style={{ padding: "0.5rem" }}>{shift.isActive ? "Aktif" : "Nonaktif"}</td>
              <td style={{ padding: "0.5rem" }}>
                {shift.isActive ? (
                  <button type="button" onClick={() => deactivate(shift.id)} disabled={busy} style={{ padding: "0.35rem 0.6rem" }}>
                    Nonaktifkan
                  </button>
                ) : "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2 style={{ fontSize: "1.1rem", marginTop: "2rem" }}>Penugasan shift</h2>
      <form
        onSubmit={assign}
        style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", alignItems: "end" }}
      >
        <label style={{ display: "grid", gap: "0.25rem" }}>
          Member
          <select value={memberId} onChange={(event) => setMemberId(event.target.value)} style={{ padding: "0.5rem" }}>
            {members.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}
          </select>
        </label>
        <label style={{ display: "grid", gap: "0.25rem" }}>
          Shift
          <select value={shiftId} onChange={(event) => setShiftId(event.target.value)} style={{ padding: "0.5rem" }}>
            {shifts.filter((shift) => shift.isActive).map((shift) => (
              <option key={shift.id} value={shift.id}>{shift.name}</option>
            ))}
          </select>
        </label>
        <label style={{ display: "grid", gap: "0.25rem" }}>
          Tanggal (kosong = default)
          <input type="date" value={workDate} onChange={(event) => setWorkDate(event.target.value)} style={{ padding: "0.5rem" }} />
        </label>
        <button
          type="submit"
          disabled={busy || !memberId || !shiftId}
          style={{ padding: "0.6rem" }}
        >
          Simpan penugasan
        </button>
      </form>

      <table style={{ width: "100%", borderCollapse: "collapse", marginTop: "1rem" }}>
        <thead>
          <tr>
            {["Member", "Shift", "Tanggal", "Jenis"].map((label) => (
              <th key={label} style={{ textAlign: "left", borderBottom: "1px solid #ccc", padding: "0.5rem" }}>{label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {assignments.length === 0 ? (
            <tr><td colSpan={4} style={{ padding: "0.75rem", color: "#555" }}>Belum ada penugasan.</td></tr>
          ) : null}
          {assignments.map((assignment) => (
            <tr key={assignment.id}>
              <td style={{ padding: "0.5rem" }}>{assignment.memberName}</td>
              <td style={{ padding: "0.5rem" }}>{assignment.shiftName}</td>
              <td style={{ padding: "0.5rem" }}>{assignment.workDate ?? "—"}</td>
              <td style={{ padding: "0.5rem" }}>{assignment.workDate ? "Per tanggal" : "Default"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
