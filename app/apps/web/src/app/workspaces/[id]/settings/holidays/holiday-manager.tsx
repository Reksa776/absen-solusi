"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

const CSRF_COOKIE = "aos_csrf";
const MONTHS = [
  "Januari",
  "Februari",
  "Maret",
  "April",
  "Mei",
  "Juni",
  "Juli",
  "Agustus",
  "September",
  "Oktober",
  "November",
  "Desember",
];
const WEEKDAYS = ["Min", "Sen", "Sel", "Rab", "Kam", "Jum", "Sab"];

type Holiday = { id: string; date: string; name: string; createdAt: string };

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

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function isoDate(year: number, month: number, day: number): string {
  return `${year}-${pad(month + 1)}-${pad(day)}`;
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
}

function monthCells(year: number, month: number): Array<number | null> {
  const offset = new Date(Date.UTC(year, month, 1)).getUTCDay();
  const cells: Array<number | null> = Array.from({ length: offset }, () => null);
  for (let day = 1; day <= daysInMonth(year, month); day += 1) cells.push(day);
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

function holidayTone(name: string): "red" | "yellow" {
  return /cuti bersama/i.test(name) ? "yellow" : "red";
}

function todayIso(): string {
  const today = new Date();
  return isoDate(today.getFullYear(), today.getMonth(), today.getDate());
}

export function HolidayManager({
  workspaceId,
  holidays,
}: {
  workspaceId: string;
  holidays: Holiday[];
}) {
  const router = useRouter();
  const now = new Date();
  const [cursor, setCursor] = useState({
    year: now.getFullYear(),
    month: now.getMonth(),
  });
  const [yearView, setYearView] = useState(false);
  const [modal, setModal] = useState<{ id: string | null; date: string } | null>(null);
  const [dateDraft, setDateDraft] = useState("");
  const [nameDraft, setNameDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const byDate = new Map(holidays.map((holiday) => [holiday.date, holiday]));
  const monthPrefix = `${cursor.year}-${pad(cursor.month + 1)}-`;
  const monthHolidays = holidays
    .filter((holiday) => holiday.date.startsWith(monthPrefix))
    .sort((left, right) => left.date.localeCompare(right.date));
  const yearHolidays = holidays
    .filter((holiday) => holiday.date.startsWith(`${cursor.year}-`))
    .sort((left, right) => left.date.localeCompare(right.date));
  const shownHolidays = yearView ? yearHolidays : monthHolidays;
  const today = todayIso();

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

  function go(delta: number) {
    if (yearView) {
      setCursor((current) => ({ ...current, year: current.year + delta }));
      return;
    }
    setCursor((current) => {
      const next = new Date(Date.UTC(current.year, current.month + delta, 1));
      return { year: next.getUTCFullYear(), month: next.getUTCMonth() };
    });
  }

  function openModal(date: string, holiday?: Holiday) {
    setModal({ id: holiday?.id ?? null, date });
    setDateDraft(holiday?.date ?? date);
    setNameDraft(holiday?.name ?? "");
    setError(null);
    setNotice(null);
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!modal) return;
    const ok = modal.id
      ? await send(`/api/workspaces/${workspaceId}/holidays/${modal.id}`, "PATCH", {
          date: dateDraft,
          name: nameDraft,
        })
      : await send(`/api/workspaces/${workspaceId}/holidays`, "POST", {
          date: dateDraft,
          name: nameDraft,
        });
    if (ok) {
      setNotice(modal.id ? "Hari libur diperbarui." : "Hari libur ditambahkan.");
      setModal(null);
      router.refresh();
    }
  }

  async function remove(id: string) {
    if (!window.confirm("Hapus hari libur ini?")) return;
    const ok = await send(`/api/workspaces/${workspaceId}/holidays/${id}`, "DELETE");
    if (ok) {
      setNotice("Hari libur dihapus.");
      setModal(null);
      router.refresh();
    }
  }

  async function importNational() {
    const ok = await send(
      `/api/workspaces/${workspaceId}/holidays/import-national`,
      "POST",
      { year: cursor.year },
    );
    if (ok) {
      setNotice(`Hari libur nasional ${cursor.year} dimuat tanpa duplikasi.`);
      router.refresh();
    }
  }

  function dayClass(date: string, day: number, month: number): string {
    const classes = ["calendar-day"];
    const holiday = byDate.get(date);
    if (holiday) classes.push(`calendar-day--${holidayTone(holiday.name)}`);
    if ((new Date(Date.UTC(cursor.year, month, day)).getUTCDay()) === 0) {
      classes.push("calendar-day--sunday");
    }
    if (date === today) classes.push("calendar-day--today");
    return classes.join(" ");
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

      <div className="calendar-toolbar">
        <div className="calendar-nav">
          <button type="button" className="btn btn--secondary btn--sm" onClick={() => go(-1)} aria-label="Sebelumnya">
            ‹
          </button>
          <strong className="calendar-title">
            {yearView ? `Tahun ${cursor.year}` : `${MONTHS[cursor.month]} ${cursor.year}`}
          </strong>
          <button type="button" className="btn btn--secondary btn--sm" onClick={() => go(1)} aria-label="Berikutnya">
            ›
          </button>
        </div>
        <div className="btn-row">
          <button
            type="button"
            className="btn btn--secondary btn--sm"
            onClick={() => setYearView((value) => !value)}
          >
            {yearView ? "Tampilan bulan" : "Ringkasan setahun"}
          </button>
          <button type="button" className="btn btn--primary btn--sm" onClick={importNational} disabled={busy}>
            {busy ? "Memproses…" : `Muat Hari Libur Nasional ${cursor.year}`}
          </button>
        </div>
      </div>

      <div className="calendar-layout">
        <div className="calendar-card">
          {yearView ? (
            <div className="calendar-year-grid">
              {MONTHS.map((label, month) => (
                <div className="calendar-mini" key={label}>
                  <button
                    type="button"
                    className="calendar-mini-title"
                    onClick={() => {
                      setCursor((current) => ({ ...current, month }));
                      setYearView(false);
                    }}
                  >
                    {label}
                  </button>
                  <div className="calendar-mini-weekdays">
                    {WEEKDAYS.map((weekday) => (
                      <span key={weekday}>{weekday.slice(0, 1)}</span>
                    ))}
                  </div>
                  <div className="calendar-mini-grid">
                    {monthCells(cursor.year, month).map((day, index) => {
                      if (day === null) {
                        return <span className="calendar-mini-day calendar-mini-day--empty" key={`empty-${index}`} />;
                      }
                      const date = isoDate(cursor.year, month, day);
                      const holiday = byDate.get(date);
                      const sunday = new Date(Date.UTC(cursor.year, month, day)).getUTCDay() === 0;
                      return (
                        <button
                          type="button"
                          key={date}
                          className={`calendar-mini-day${holiday ? ` calendar-mini-day--${holidayTone(holiday.name)}` : ""}${sunday ? " calendar-mini-day--sunday" : ""}${date === today ? " calendar-mini-day--today" : ""}`}
                          title={holiday?.name ?? date}
                          onClick={() => openModal(date, holiday)}
                        >
                          {day}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <>
              <div className="calendar-weekdays">
                {WEEKDAYS.map((weekday, index) => (
                  <span key={weekday} className={index === 0 ? "calendar-weekday--sunday" : undefined}>
                    {weekday}
                  </span>
                ))}
              </div>
              <div className="calendar-grid">
                {monthCells(cursor.year, cursor.month).map((day, index) => {
                  if (day === null) {
                    return <span className="calendar-day calendar-day--empty" key={`empty-${index}`} />;
                  }
                  const date = isoDate(cursor.year, cursor.month, day);
                  const holiday = byDate.get(date);
                  return (
                    <button
                      type="button"
                      key={date}
                      className={dayClass(date, day, cursor.month)}
                      onClick={() => openModal(date, holiday)}
                    >
                      <span className="calendar-day-num">{day}</span>
                      {holiday ? (
                        <span className="calendar-holiday-name">{holiday.name}</span>
                      ) : null}
                    </button>
                  );
                })}
              </div>
            </>
          )}
        </div>

        <aside className="card card-pad calendar-side">
          <div className="card-head" style={{ padding: 0, borderBottom: "none" }}>
            <div>
              <h2 className="section-title">
                {yearView ? `Libur ${cursor.year}` : `Libur ${MONTHS[cursor.month]}`}
              </h2>
              <p className="section-note">
                <span className="num">{shownHolidays.length}</span> tanggal ditandai
              </p>
            </div>
            <span className="badge badge--yellow">Kalender</span>
          </div>
          <ul className="calendar-list">
            {shownHolidays.length === 0 ? (
              <li className="section-note">Belum ada hari libur pada periode ini.</li>
            ) : null}
            {shownHolidays.map((holiday) => (
              <li key={holiday.id}>
                <button
                  type="button"
                  className="calendar-list-main"
                  onClick={() => openModal(holiday.date, holiday)}
                >
                  <span className="calendar-list-date">{holiday.date.slice(8, 10)}</span>
                  <span>
                    <strong>{holiday.name}</strong>
                    <small>{holiday.date}</small>
                  </span>
                </button>
                <button
                  type="button"
                  className="btn btn--danger btn--sm"
                  onClick={() => remove(holiday.id)}
                  disabled={busy}
                >
                  Hapus
                </button>
              </li>
            ))}
          </ul>
          <p className="section-note" style={{ marginTop: "0.8rem" }}>
            Klik tanggal mana pun di kalender untuk menandai atau mengubah hari libur.
          </p>
        </aside>
      </div>

      {modal ? (
        <div
          className="calendar-modal-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setModal(null);
          }}
        >
          <div className="calendar-modal" role="dialog" aria-modal="true" aria-label="Hari libur">
            <div className="card-head" style={{ padding: 0, borderBottom: "none" }}>
              <div>
                <h2 className="section-title">{modal.id ? "Edit hari libur" : "Tandai hari libur"}</h2>
                <p className="section-note">{modal.date}</p>
              </div>
              <button type="button" className="btn btn--secondary btn--sm" onClick={() => setModal(null)}>
                Tutup
              </button>
            </div>
            <form onSubmit={save} className="stack" style={{ marginTop: "0.9rem" }}>
              <label className="field">
                Tanggal
                <input type="date" required value={dateDraft} onChange={(event) => setDateDraft(event.target.value)} />
              </label>
              <label className="field">
                Keterangan libur
                <input
                  type="text"
                  required
                  maxLength={120}
                  placeholder="Contoh: Cuti bersama Natal"
                  value={nameDraft}
                  onChange={(event) => setNameDraft(event.target.value)}
                />
              </label>
              <div className="btn-row">
                <button type="submit" className="btn btn--primary" disabled={busy}>
                  {busy ? "Menyimpan…" : "Simpan"}
                </button>
                <button type="button" className="btn btn--secondary" onClick={() => setModal(null)} disabled={busy}>
                  Batal
                </button>
                {modal.id ? (
                  <button type="button" className="btn btn--danger" onClick={() => remove(modal.id!)} disabled={busy}>
                    Hapus libur
                  </button>
                ) : null}
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </section>
  );
}
