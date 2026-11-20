"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

const CSRF_COOKIE = "aos_csrf";

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

export function HolidayManager({
  workspaceId,
  holidays,
}: {
  workspaceId: string;
  holidays: Holiday[];
}) {
  const router = useRouter();
  const [date, setDate] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function send(url: string, method: "POST" | "DELETE", payload?: unknown) {
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

  async function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const ok = await send(`/api/workspaces/${workspaceId}/holidays`, "POST", {
      date,
      name,
    });
    if (ok) {
      setDate("");
      setName("");
      setNotice("Hari libur ditambahkan.");
      router.refresh();
    }
  }

  async function remove(id: string) {
    const ok = await send(
      `/api/workspaces/${workspaceId}/holidays/${id}`,
      "DELETE",
    );
    if (ok) {
      setNotice("Hari libur dihapus.");
      router.refresh();
    }
  }

  return (
    <section>
      <form onSubmit={add} className="form-card">
        <div className="form-row">
          <label className="field" style={{ flex: "0 1 11rem" }}>
            Tanggal
            <input
              type="date"
              required
              value={date}
              onChange={(event) => setDate(event.target.value)}
            />
          </label>
          <label className="field" style={{ flex: "1 1 14rem" }}>
            Nama
            <input
              type="text"
              required
              maxLength={120}
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          <button type="submit" className="btn btn--primary" disabled={busy}>
            {busy ? "Memproses…" : "Tambah hari libur"}
          </button>
        </div>
      </form>

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
            <h2 className="section-title">Tanggal libur</h2>
            <p className="section-note">{holidays.length} entri</p>
          </div>
        </div>
        <div className="table-scroll">
          <table className="data">
            <thead>
              <tr>
                {["Tanggal", "Nama", "Aksi"].map((label) => (
                  <th key={label}>{label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {holidays.length === 0 ? (
                <tr>
                  <td colSpan={3} className="empty">
                    Belum ada hari libur.
                  </td>
                </tr>
              ) : null}
              {holidays.map((holiday) => (
                <tr key={holiday.id}>
                  <td className="mono nowrap">{holiday.date}</td>
                  <td>{holiday.name}</td>
                  <td>
                    <button
                      type="button"
                      className="btn btn--danger btn--sm"
                      onClick={() => remove(holiday.id)}
                      disabled={busy}
                    >
                      Hapus
                    </button>
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
