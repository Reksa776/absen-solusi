"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { sendJson } from "@/lib/browser-api";

export type PatternDay = {
  id?: string;
  dayOfWeek: number;
  dayName: string;
  isWorkday: boolean;
  startTime: string;
  endTime: string;
  earliestCheckInMinutes: number;
  lateToleranceMinutes: number;
};

export type WorkPatternRow = {
  id: string;
  name: string;
  timezone: string;
  isActive: boolean;
  assignedCount: number;
  days: PatternDay[];
};

/** Pemetaan JavaScript: Minggu=0, Senin=1 ... Sabtu=6. */
const DAYS = [
  { dayOfWeek: 1, dayName: "Senin" },
  { dayOfWeek: 2, dayName: "Selasa" },
  { dayOfWeek: 3, dayName: "Rabu" },
  { dayOfWeek: 4, dayName: "Kamis" },
  { dayOfWeek: 5, dayName: "Jumat" },
  { dayOfWeek: 6, dayName: "Sabtu" },
  { dayOfWeek: 0, dayName: "Minggu" },
] as const;

function newDay(dayOfWeek: number, dayName: string): PatternDay {
  return {
    dayOfWeek,
    dayName,
    isWorkday: dayOfWeek >= 1 && dayOfWeek <= 5,
    startTime: "09:00",
    endTime: "17:00",
    earliestCheckInMinutes: 120,
    lateToleranceMinutes: 15,
  };
}

function defaultDays(): PatternDay[] {
  return DAYS.map((day) => newDay(day.dayOfWeek, day.dayName));
}

function draftDays(pattern?: WorkPatternRow): PatternDay[] {
  if (!pattern) return defaultDays();
  return DAYS.map((day) => {
    const existing = pattern.days.find((entry) => entry.dayOfWeek === day.dayOfWeek);
    return existing ?? newDay(day.dayOfWeek, day.dayName);
  });
}

export function WorkPatternEditor({
  workspaceId,
  pattern,
  onSaved,
  onCancel,
}: {
  workspaceId: string;
  pattern?: WorkPatternRow | undefined;
  onSaved: () => void;
  onCancel?: (() => void) | undefined;
}) {
  const [name, setName] = useState(pattern?.name ?? "");
  const [timezone, setTimezone] = useState(pattern?.timezone ?? "Asia/Jakarta");
  const [days, setDays] = useState<PatternDay[]>(() => draftDays(pattern));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function updateDay(dayOfWeek: number, patch: Partial<PatternDay>) {
    setDays((current) =>
      current.map((day) => (day.dayOfWeek === dayOfWeek ? { ...day, ...patch } : day)),
    );
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await sendJson(
        pattern
          ? `/api/workspaces/${workspaceId}/work-patterns/${pattern.id}`
          : `/api/workspaces/${workspaceId}/work-patterns`,
        pattern ? "PATCH" : "POST",
        { name, timezone, days },
      );
      onSaved();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Pola kerja gagal disimpan.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="form-card" aria-label="Form pola kerja">
      <div className="table-head" style={{ padding: "0 0 0.85rem", borderBottom: "none" }}>
        <div>
          <h2 className="section-title">{pattern ? "Edit pola kerja" : "Tambah pola kerja"}</h2>
          <p className="section-note">
            Atur jam kerja, batas awal absen, dan toleransi untuk setiap hari.
          </p>
        </div>
      </div>
      {error ? (
        <p role="alert" className="alert">
          {error}
        </p>
      ) : null}
      <div className="form-grid">
        <label className="field">
          Nama pola
          <input
            required
            maxLength={120}
            value={name}
            placeholder="Pola kantor pusat"
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <label className="field">
          Zona waktu
          <input
            required
            maxLength={64}
            className="mono"
            value={timezone}
            placeholder="Asia/Jakarta"
            onChange={(event) => setTimezone(event.target.value)}
          />
        </label>
      </div>

      <div className="pattern-days" role="table" aria-label="Jadwal mingguan">
        <div className="pattern-day-head" role="row">
          <span>Hari</span>
          <span>Masuk</span>
          <span>Pulang</span>
          <span>Awal absen</span>
          <span>Toleransi telat</span>
          <span>Status</span>
        </div>
        {days.map((day) => (
          <div className="pattern-day-row" role="row" key={day.dayOfWeek}>
            <strong>{day.dayName}</strong>
            <label className="field field--compact">
              <span className="sr-only">Jam masuk {day.dayName}</span>
              <input
                type="time"
                required
                className="mono"
                value={day.startTime}
                onChange={(event) => updateDay(day.dayOfWeek, { startTime: event.target.value })}
              />
            </label>
            <label className="field field--compact">
              <span className="sr-only">Jam pulang {day.dayName}</span>
              <input
                type="time"
                required
                className="mono"
                value={day.endTime}
                onChange={(event) => updateDay(day.dayOfWeek, { endTime: event.target.value })}
              />
            </label>
            <label className="field field--compact">
              <span className="sr-only">Batas awal check-in {day.dayName}</span>
              <input
                type="number"
                min={0}
                max={720}
                required
                className="mono"
                value={day.earliestCheckInMinutes}
                onChange={(event) =>
                  updateDay(day.dayOfWeek, {
                    earliestCheckInMinutes: Number(event.target.value),
                  })
                }
              />
            </label>
            <label className="field field--compact">
              <span className="sr-only">Toleransi keterlambatan {day.dayName}</span>
              <input
                type="number"
                min={0}
                max={180}
                required
                className="mono"
                value={day.lateToleranceMinutes}
                onChange={(event) =>
                  updateDay(day.dayOfWeek, {
                    lateToleranceMinutes: Number(event.target.value),
                  })
                }
              />
            </label>
            <div
              className="pattern-day-status"
              role="group"
              aria-label={`Status ${day.dayName}`}
            >
              <button
                type="button"
                className={`pattern-toggle${day.isWorkday ? " pattern-toggle--active" : ""}`}
                aria-pressed={day.isWorkday}
                onClick={() => updateDay(day.dayOfWeek, { isWorkday: true })}
              >
                Kerja
              </button>
              <button
                type="button"
                className={`pattern-toggle${!day.isWorkday ? " pattern-toggle--off" : ""}`}
                aria-pressed={!day.isWorkday}
                onClick={() => updateDay(day.dayOfWeek, { isWorkday: false })}
              >
                Libur
              </button>
            </div>
          </div>
        ))}
      </div>
      <p className="field-hint" style={{ marginTop: "0.5rem" }}>
        Aktifkan Sabtu bila hari tersebut hari kerja; jam masuk, pulang, dan toleransi
        dapat berbeda dari hari lain. Awal absen dan toleransi memakai satuan menit.
      </p>
      <div className="btn-row" style={{ marginTop: "0.9rem" }}>
        <button type="submit" className="btn btn--primary" disabled={busy}>
          {busy ? "Menyimpan..." : pattern ? "Simpan perubahan" : "Tambah pola kerja"}
        </button>
        {onCancel ? (
          <button type="button" className="btn btn--secondary" onClick={onCancel} disabled={busy}>
            Batal
          </button>
        ) : null}
      </div>
    </form>
  );
}

export function WorkPatternManager({
  workspaceId,
  patterns,
  canManage,
}: {
  workspaceId: string;
  patterns: WorkPatternRow[];
  canManage: boolean;
}) {
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<WorkPatternRow | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function deactivate(pattern: WorkPatternRow) {
    if (!window.confirm(`Nonaktifkan pola "${pattern.name}"?`)) return;
    setBusy(true);
    setError(null);
    try {
      await sendJson(`/api/workspaces/${workspaceId}/work-patterns/${pattern.id}`, "DELETE");
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Pola gagal dinonaktifkan.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section>
      {error ? (
        <p role="alert" className="alert">
          {error}
        </p>
      ) : null}
      {!creating && !editing && canManage ? (
        <div className="btn-row" style={{ marginBottom: "1rem" }}>
          <button type="button" className="btn btn--primary" onClick={() => setCreating(true)}>
            Tambah pola kerja
          </button>
        </div>
      ) : null}
      {creating && canManage ? (
        <WorkPatternEditor
          workspaceId={workspaceId}
          onSaved={() => {
            setCreating(false);
            router.refresh();
          }}
          onCancel={() => setCreating(false)}
        />
      ) : null}
      {editing && canManage ? (
        <WorkPatternEditor
          workspaceId={workspaceId}
          pattern={editing}
          onSaved={() => {
            setEditing(null);
            router.refresh();
          }}
          onCancel={() => setEditing(null)}
        />
      ) : null}

      <div className="table-wrap">
        <div className="table-head">
          <div>
            <h2 className="section-title">Pola kerja mingguan</h2>
            <p className="section-note">
              <span className="num">{patterns.length}</span> templat terdaftar
            </p>
          </div>
        </div>
        <div className="table-scroll">
          <table className="data">
            <thead>
              <tr>
                {["Pola", "Zona waktu", "Hari kerja", "Karyawan", "Status", "Aksi"].map((label) => (
                  <th key={label}>{label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {patterns.length === 0 ? (
                <tr>
                  <td colSpan={6} className="empty">
                    Belum ada pola kerja. Tambahkan templat pertama.
                  </td>
                </tr>
              ) : null}
              {patterns.map((pattern) => {
                const workdays = pattern.days.filter((day) => day.isWorkday);
                return (
                  <tr key={pattern.id}>
                    <td>
                      <span className="cell-title">{pattern.name}</span>
                      <span className="cell-sub">
                        {workdays.map((day) => day.dayName.slice(0, 3)).join(", ") || "Tanpa hari kerja"}
                      </span>
                    </td>
                    <td className="mono">{pattern.timezone}</td>
                    <td className="num">{workdays.length}</td>
                    <td className="num">{pattern.assignedCount}</td>
                    <td>
                      <span
                        className={pattern.isActive ? "badge badge--green" : "badge badge--neutral"}
                      >
                        {pattern.isActive ? "Aktif" : "Nonaktif"}
                      </span>
                    </td>
                    <td>
                      {canManage ? (
                        <div className="btn-row">
                          <button
                            type="button"
                            className="btn btn--secondary btn--sm"
                            onClick={() => setEditing(pattern)}
                            disabled={busy}
                          >
                            Edit
                          </button>
                          {pattern.isActive ? (
                            <button
                              type="button"
                              className="btn btn--danger btn--sm"
                              onClick={() => deactivate(pattern)}
                              disabled={busy}
                            >
                              Nonaktifkan
                            </button>
                          ) : null}
                        </div>
                      ) : (
                        <span className="muted">Lihat</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
