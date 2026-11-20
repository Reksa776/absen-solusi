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
      <form
        onSubmit={add}
        style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", alignItems: "end" }}
      >
        <label style={{ display: "grid", gap: "0.25rem" }}>
          Tanggal
          <input
            type="date"
            required
            value={date}
            onChange={(event) => setDate(event.target.value)}
            style={{ padding: "0.5rem" }}
          />
        </label>
        <label style={{ display: "grid", gap: "0.25rem", flex: 1, minWidth: "12rem" }}>
          Nama
          <input
            type="text"
            required
            maxLength={120}
            value={name}
            onChange={(event) => setName(event.target.value)}
            style={{ padding: "0.5rem" }}
          />
        </label>
        <button type="submit" disabled={busy} style={{ padding: "0.6rem" }}>
          {busy ? "Memproses…" : "Tambah hari libur"}
        </button>
      </form>

      {error ? (
        <p role="alert" style={{ color: "#b00020" }}>
          {error}
        </p>
      ) : null}
      {notice ? <p role="status">{notice}</p> : null}

      <table style={{ width: "100%", borderCollapse: "collapse", marginTop: "1rem" }}>
        <thead>
          <tr>
            {["Tanggal", "Nama", "Aksi"].map((label) => (
              <th
                key={label}
                style={{ textAlign: "left", borderBottom: "1px solid #ccc", padding: "0.5rem" }}
              >
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {holidays.length === 0 ? (
            <tr>
              <td colSpan={3} style={{ padding: "0.75rem", color: "#555" }}>
                Belum ada hari libur.
              </td>
            </tr>
          ) : null}
          {holidays.map((holiday) => (
            <tr key={holiday.id}>
              <td style={{ padding: "0.5rem" }}>{holiday.date}</td>
              <td style={{ padding: "0.5rem" }}>{holiday.name}</td>
              <td style={{ padding: "0.5rem" }}>
                <button
                  type="button"
                  onClick={() => remove(holiday.id)}
                  disabled={busy}
                  style={{ padding: "0.35rem 0.6rem" }}
                >
                  Hapus
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
