"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { sendJson } from "@/lib/browser-api";

type Member = { id: string; name: string; divisionName: string | null };
type Schedule = {
  id: string;
  memberId: string;
  memberName: string;
  divisionName: string | null;
  date: string;
  startTime: string;
  endTime: string;
  durationMinutes: number;
  notes: string | null;
  status: string;
};

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export function OvertimeScheduleManager({
  workspaceId,
  members,
  schedules,
}: {
  workspaceId: string;
  members: Member[];
  schedules: Schedule[];
}) {
  const router = useRouter();
  const [memberId, setMemberId] = useState(members[0]?.id ?? "");
  const [date, setDate] = useState(today());
  const [startTime, setStartTime] = useState("17:00");
  const [endTime, setEndTime] = useState("19:00");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await sendJson(`/api/workspaces/${workspaceId}/overtime/schedules`, "POST", {
        memberId,
        date,
        startTime,
        endTime,
        notes,
      });
      setNotice("Jadwal lembur dibuat dan terlihat di mobile karyawan.");
      setNotes("");
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Jadwal lembur gagal dibuat.");
    } finally {
      setBusy(false);
    }
  }

  async function cancel(schedule: Schedule) {
    if (!window.confirm(`Batalkan jadwal lembur ${schedule.memberName}?`)) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await sendJson(
        `/api/workspaces/${workspaceId}/overtime/schedules/${schedule.id}`,
        "PATCH",
      );
      setNotice("Jadwal lembur dibatalkan.");
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Jadwal gagal dibatalkan.");
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
      {notice ? (
        <p role="status" className="notice">
          {notice}
        </p>
      ) : null}
      <form onSubmit={create} className="form-card">
        <h2 className="section-title">Surat tugas lembur</h2>
        <p className="section-note" style={{ marginBottom: "0.8rem" }}>
          Jadwal ini tampil di tab Pengajuan pada aplikasi mobile karyawan.
        </p>
        <div className="form-grid">
          <label className="field">
            Karyawan
            <select value={memberId} onChange={(event) => setMemberId(event.target.value)}>
              {members.map((member) => (
                <option key={member.id} value={member.id}>
                  {member.name}
                  {member.divisionName ? ` - ${member.divisionName}` : ""}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            Tanggal
            <input
              type="date"
              required
              className="mono"
              value={date}
              onChange={(event) => setDate(event.target.value)}
            />
          </label>
          <label className="field">
            Mulai
            <input
              type="time"
              required
              className="mono"
              value={startTime}
              onChange={(event) => setStartTime(event.target.value)}
            />
          </label>
          <label className="field">
            Selesai
            <input
              type="time"
              required
              className="mono"
              value={endTime}
              onChange={(event) => setEndTime(event.target.value)}
            />
          </label>
          <label className="field field--wide">
            Catatan tugas
            <input
              maxLength={1000}
              value={notes}
              placeholder="Penyelesaian laporan bulanan"
              onChange={(event) => setNotes(event.target.value)}
            />
          </label>
        </div>
        <div className="btn-row" style={{ marginTop: "0.9rem" }}>
          <button type="submit" className="btn btn--primary" disabled={busy || !memberId}>
            {busy ? "Menyimpan..." : "Buat jadwal lembur"}
          </button>
        </div>
      </form>

      <div className="table-wrap">
        <div className="table-head">
          <div>
            <h2 className="section-title">Jadwal lembur</h2>
            <p className="section-note">
              <span className="num">{schedules.length}</span> jadwal terdaftar
            </p>
          </div>
        </div>
        <div className="table-scroll">
          <table className="data">
            <thead>
              <tr>
                {["Karyawan", "Tanggal", "Jam", "Durasi", "Catatan", "Status", "Aksi"].map(
                  (label) => (
                    <th key={label}>{label}</th>
                  ),
                )}
              </tr>
            </thead>
            <tbody>
              {schedules.length === 0 ? (
                <tr>
                  <td colSpan={7} className="empty">
                    Belum ada jadwal lembur.
                  </td>
                </tr>
              ) : null}
              {schedules.map((schedule) => (
                <tr key={schedule.id}>
                  <td>
                    <span className="cell-title">{schedule.memberName}</span>
                    <span className="cell-sub">{schedule.divisionName ?? "—"}</span>
                  </td>
                  <td className="mono nowrap">{schedule.date}</td>
                  <td className="mono nowrap">
                    {schedule.startTime}-{schedule.endTime}
                  </td>
                  <td className="num">{schedule.durationMinutes} menit</td>
                  <td className="muted">{schedule.notes ?? "—"}</td>
                  <td>
                    <span
                      className={
                        schedule.status === "PLANNED"
                          ? "badge badge--yellow"
                          : "badge badge--neutral"
                      }
                    >
                      {schedule.status === "PLANNED" ? "Dijadwalkan" : "Dibatalkan"}
                    </span>
                  </td>
                  <td>
                    {schedule.status === "PLANNED" ? (
                      <button
                        type="button"
                        className="btn btn--danger btn--sm"
                        onClick={() => cancel(schedule)}
                        disabled={busy}
                      >
                        Batalkan
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
    </section>
  );
}

type OvertimeSetting = {
  minDurationMinutes: number;
  roundingMinutes: number;
  maxDailyMinutes: number;
  maxMonthlyMinutes: number;
  weekdayMultiplier: number;
  holidayMultiplier: number;
};

export function OvertimeSettingsForm({
  workspaceId,
  setting,
}: {
  workspaceId: string;
  setting: OvertimeSetting;
}) {
  const router = useRouter();
  const [form, setForm] = useState(setting);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  function numberField(key: keyof OvertimeSetting, value: string) {
    setForm((current) => ({ ...current, [key]: Number(value) }));
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await sendJson(`/api/workspaces/${workspaceId}/overtime/settings`, "PATCH", form);
      setNotice("Pengaturan lembur disimpan dan dipakai pada perhitungan gaji.");
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
          Durasi minimum (menit)
          <input
            type="number"
            min={1}
            max={720}
            required
            className="mono"
            value={form.minDurationMinutes}
            onChange={(event) => numberField("minDurationMinutes", event.target.value)}
          />
        </label>
        <label className="field">
          Pembulatan (menit)
          <input
            type="number"
            min={1}
            max={120}
            required
            className="mono"
            value={form.roundingMinutes}
            onChange={(event) => numberField("roundingMinutes", event.target.value)}
          />
        </label>
        <label className="field">
          Batas harian (menit)
          <input
            type="number"
            min={1}
            max={1440}
            required
            className="mono"
            value={form.maxDailyMinutes}
            onChange={(event) => numberField("maxDailyMinutes", event.target.value)}
          />
        </label>
        <label className="field">
          Batas bulanan (menit)
          <input
            type="number"
            min={1}
            max={44640}
            required
            className="mono"
            value={form.maxMonthlyMinutes}
            onChange={(event) => numberField("maxMonthlyMinutes", event.target.value)}
          />
        </label>
        <label className="field">
          Pengali hari kerja
          <input
            type="number"
            min={0.1}
            max={10}
            step={0.1}
            required
            className="mono"
            value={form.weekdayMultiplier}
            onChange={(event) => numberField("weekdayMultiplier", event.target.value)}
          />
        </label>
        <label className="field">
          Pengali hari libur
          <input
            type="number"
            min={0.1}
            max={10}
            step={0.1}
            required
            className="mono"
            value={form.holidayMultiplier}
            onChange={(event) => numberField("holidayMultiplier", event.target.value)}
          />
        </label>
      </div>
      <p className="field-hint" style={{ marginTop: "0.65rem" }}>
        Nilai ini diterapkan pada preview dan generate payroll: durasi minimum, pembulatan,
        batas harian/bulanan, serta pengali tarif hari kerja dan hari libur.
      </p>
      <div className="btn-row" style={{ marginTop: "0.9rem" }}>
        <button type="submit" className="btn btn--primary" disabled={busy}>
          {busy ? "Menyimpan..." : "Simpan pengaturan"}
        </button>
      </div>
    </form>
  );
}
