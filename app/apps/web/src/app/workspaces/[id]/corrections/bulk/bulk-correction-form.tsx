"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

const CSRF_COOKIE = "aos_csrf";
const MIN_REASON = 10;

type MemberOption = { id: string; name: string; email: string };

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

export function BulkCorrectionForm({
  workspaceId,
  members,
}: {
  workspaceId: string;
  members: MemberOption[];
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [type, setType] = useState("CHECK_IN");
  const [time, setTime] = useState("09:00");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  function toggle(id: string): void {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll(): void {
    setSelected((current) =>
      current.size === members.length ? new Set() : new Set(members.map((member) => member.id)),
    );
  }

  async function submit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    setNotice(null);
    if (selected.size === 0) {
      setError("Pilih minimal satu karyawan.");
      return;
    }
    if (reason.trim().length < MIN_REASON) {
      setError(`Alasan koreksi minimal ${MIN_REASON} karakter.`);
      return;
    }
    const local = new Date(`${date}T${time}:00`);
    if (Number.isNaN(local.getTime())) {
      setError("Tanggal atau jam tidak valid.");
      return;
    }
    setBusy(true);
    try {
      const token = await csrfToken();
      const response = await fetch(`/api/workspaces/${workspaceId}/corrections/bulk`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json", "x-csrf-token": token },
        body: JSON.stringify({
          memberIds: [...selected],
          date,
          type,
          timestamp: local.toISOString(),
          reason: reason.trim(),
        }),
      });
      const body = (await response.json().catch(() => ({}))) as {
        updated?: number;
        error?: { message?: string };
      };
      if (!response.ok) {
        setError(body.error?.message ?? "Koreksi massal gagal.");
        return;
      }
      setNotice(`${body.updated ?? 0} absensi berhasil dikoreksi.`);
      setSelected(new Set());
      setReason("");
      router.refresh();
    } catch {
      setError("Tidak dapat menghubungi server.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} data-testid="bulk-correction-form">
      <fieldset style={{ border: "1px solid #ddd", borderRadius: "0.5rem", padding: "1rem" }}>
        <legend style={{ padding: "0 0.4rem", fontWeight: 600 }}>Karyawan</legend>
        <button type="button" onClick={toggleAll} style={{ marginBottom: "0.75rem", padding: "0.35rem 0.6rem" }}>
          {selected.size === members.length && members.length > 0
            ? "Batalkan semua"
            : "Pilih semua"}
        </button>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(15rem, 1fr))", gap: "0.4rem" }}>
          {members.map((member) => (
            <label key={member.id} style={{ display: "flex", gap: "0.45rem", alignItems: "flex-start" }}>
              <input
                type="checkbox"
                checked={selected.has(member.id)}
                onChange={() => toggle(member.id)}
                data-testid={`bulk-member-${member.id}`}
                style={{ marginTop: "0.25rem" }}
              />
              <span>
                {member.name}
                <br />
                <span style={{ color: "#666", fontSize: "0.8rem" }}>{member.email}</span>
              </span>
            </label>
          ))}
        </div>
        {members.length === 0 ? <p style={{ color: "#555" }}>Belum ada karyawan aktif.</p> : null}
      </fieldset>

      <div style={{ display: "flex", flexWrap: "wrap", gap: "1rem", marginTop: "1rem" }}>
        <label>
          Tanggal
          <br />
          <input type="date" value={date} onChange={(event) => setDate(event.target.value)} required />
        </label>
        <label>
          Tipe
          <br />
          <select value={type} onChange={(event) => setType(event.target.value)}>
            <option value="CHECK_IN">Check-in</option>
            <option value="CHECK_OUT">Check-out</option>
          </select>
        </label>
        <label>
          Jam baru
          <br />
          <input type="time" value={time} onChange={(event) => setTime(event.target.value)} required />
        </label>
      </div>

      <label style={{ display: "block", marginTop: "1rem" }}>
        Alasan wajib
        <br />
        <textarea
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          minLength={MIN_REASON}
          maxLength={1000}
          rows={3}
          required
          style={{ width: "min(42rem, 100%)", padding: "0.5rem" }}
          placeholder="Contoh: gangguan jaringan kantor cabang pada pagi hari"
        />
      </label>

      {error ? <p role="alert" style={{ color: "#b00020" }}>{error}</p> : null}
      {notice ? <p role="status">{notice}</p> : null}
      <button type="submit" disabled={busy} style={{ marginTop: "1rem", padding: "0.6rem 1rem" }}>
        {busy ? "Memproses…" : "Eksekusi koreksi massal"}
      </button>
    </form>
  );
}
