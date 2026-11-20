"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

const CSRF_COOKIE = "aos_csrf";

type Office = {
  id: string;
  name: string;
  address: string | null;
  latitude: number;
  longitude: number;
  radiusMeters: number;
  timezone: string;
  workStart: string;
  workEnd: string;
  isActive: boolean;
};

type FormState = {
  name: string;
  address: string;
  latitude: string;
  longitude: string;
  radiusMeters: string;
  timezone: string;
  workStart: string;
  workEnd: string;
  isActive: boolean;
};

const EMPTY_FORM: FormState = {
  name: "",
  address: "",
  latitude: "-6.2",
  longitude: "106.816666",
  radiusMeters: "100",
  timezone: "Asia/Jakarta",
  workStart: "09:00",
  workEnd: "17:00",
  isActive: true,
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

function toForm(office: Office): FormState {
  return {
    name: office.name,
    address: office.address ?? "",
    latitude: String(office.latitude),
    longitude: String(office.longitude),
    radiusMeters: String(office.radiusMeters),
    timezone: office.timezone,
    workStart: office.workStart,
    workEnd: office.workEnd,
    isActive: office.isActive,
  };
}

export function OfficeManager({
  workspaceId,
  offices,
}: {
  workspaceId: string;
  offices: Office[];
}) {
  const router = useRouter();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function reset() {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setError(null);
  }

  function edit(office: Office) {
    setEditingId(office.id);
    setForm(toForm(office));
    setError(null);
    setNotice(null);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const token = await csrfToken();
      const response = await fetch(
        editingId
          ? `/api/workspaces/${workspaceId}/office/${editingId}`
          : `/api/workspaces/${workspaceId}/office`,
        {
          method: editingId ? "PATCH" : "POST",
          credentials: "same-origin",
          headers: { "content-type": "application/json", "x-csrf-token": token },
          body: JSON.stringify({
            ...form,
            latitude: Number(form.latitude),
            longitude: Number(form.longitude),
            radiusMeters: Number(form.radiusMeters),
          }),
        },
      );
      const body = (await response.json().catch(() => ({}))) as {
        error?: { message?: string };
      };
      if (!response.ok) {
        setError(body.error?.message ?? "Kantor tidak dapat disimpan.");
        return;
      }
      setNotice(editingId ? "Kantor diperbarui." : "Kantor dibuat.");
      reset();
      router.refresh();
    } catch {
      setError("Tidak dapat menghubungi server.");
    } finally {
      setBusy(false);
    }
  }

  async function setActive(office: Office, isActive: boolean) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const token = await csrfToken();
      const response = await fetch(
        `/api/workspaces/${workspaceId}/office/${office.id}`,
        {
          method: "PATCH",
          credentials: "same-origin",
          headers: { "content-type": "application/json", "x-csrf-token": token },
          body: JSON.stringify({ isActive }),
        },
      );
      const body = (await response.json().catch(() => ({}))) as {
        error?: { message?: string };
      };
      if (!response.ok) {
        setError(body.error?.message ?? "Status kantor tidak dapat diubah.");
        return;
      }
      setNotice(isActive ? "Kantor diaktifkan." : "Kantor dinonaktifkan.");
      router.refresh();
    } catch {
      setError("Tidak dapat menghubungi server.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section>
      {error ? (
        <p role="alert" style={{ color: "#b00020" }}>
          {error}
        </p>
      ) : null}
      {notice ? <p role="status">{notice}</p> : null}

      <form
        onSubmit={submit}
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(13rem, 1fr))",
          gap: "0.75rem",
          alignItems: "end",
          padding: "1rem",
          background: "#f5f5f5",
          marginBottom: "1.5rem",
        }}
      >
        <label style={{ display: "grid", gap: "0.25rem" }}>
          Nama kantor
          <input
            required
            maxLength={120}
            value={form.name}
            onChange={(event) => update("name", event.target.value)}
            style={{ padding: "0.5rem" }}
          />
        </label>
        <label style={{ display: "grid", gap: "0.25rem" }}>
          Alamat
          <input
            maxLength={255}
            value={form.address}
            onChange={(event) => update("address", event.target.value)}
            style={{ padding: "0.5rem" }}
          />
        </label>
        <label style={{ display: "grid", gap: "0.25rem" }}>
          Latitude
          <input
            required
            type="number"
            step="any"
            min={-90}
            max={90}
            value={form.latitude}
            onChange={(event) => update("latitude", event.target.value)}
            style={{ padding: "0.5rem" }}
          />
        </label>
        <label style={{ display: "grid", gap: "0.25rem" }}>
          Longitude
          <input
            required
            type="number"
            step="any"
            min={-180}
            max={180}
            value={form.longitude}
            onChange={(event) => update("longitude", event.target.value)}
            style={{ padding: "0.5rem" }}
          />
        </label>
        <label style={{ display: "grid", gap: "0.25rem" }}>
          Radius (meter)
          <input
            required
            type="number"
            min={10}
            max={5000}
            value={form.radiusMeters}
            onChange={(event) => update("radiusMeters", event.target.value)}
            style={{ padding: "0.5rem" }}
          />
        </label>
        <label style={{ display: "grid", gap: "0.25rem" }}>
          Timezone (IANA)
          <input
            required
            maxLength={64}
            value={form.timezone}
            onChange={(event) => update("timezone", event.target.value)}
            style={{ padding: "0.5rem" }}
          />
        </label>
        <label style={{ display: "grid", gap: "0.25rem" }}>
          Jam masuk
          <input
            required
            type="time"
            value={form.workStart}
            onChange={(event) => update("workStart", event.target.value)}
            style={{ padding: "0.5rem" }}
          />
        </label>
        <label style={{ display: "grid", gap: "0.25rem" }}>
          Jam pulang
          <input
            required
            type="time"
            value={form.workEnd}
            onChange={(event) => update("workEnd", event.target.value)}
            style={{ padding: "0.5rem" }}
          />
        </label>
        <label style={{ display: "flex", gap: "0.4rem", alignItems: "center" }}>
          <input
            type="checkbox"
            checked={form.isActive}
            onChange={(event) => update("isActive", event.target.checked)}
          />
          Aktif
        </label>
        <div style={{ display: "flex", gap: "0.5rem" }}>
          <button type="submit" disabled={busy} style={{ padding: "0.6rem" }}>
            {busy ? "Memproses…" : editingId ? "Simpan perubahan" : "Tambah kantor"}
          </button>
          {editingId ? (
            <button type="button" onClick={reset} disabled={busy} style={{ padding: "0.6rem" }}>
              Batal
            </button>
          ) : null}
        </div>
      </form>

      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.9rem" }}>
        <thead>
          <tr>
            {["Nama", "Alamat", "Koordinat", "Radius", "Timezone", "Jam", "Status", "Aksi"].map(
              (label) => (
                <th
                  key={label}
                  style={{ textAlign: "left", borderBottom: "1px solid #ccc", padding: "0.5rem" }}
                >
                  {label}
                </th>
              ),
            )}
          </tr>
        </thead>
        <tbody>
          {offices.length === 0 ? (
            <tr>
              <td colSpan={8} style={{ padding: "0.75rem", color: "#555" }}>
                Belum ada kantor. Tambahkan minimal satu agar check-in dapat dipakai.
              </td>
            </tr>
          ) : null}
          {offices.map((office) => (
            <tr key={office.id}>
              <td style={{ padding: "0.5rem" }}>{office.name}</td>
              <td style={{ padding: "0.5rem" }}>{office.address ?? "—"}</td>
              <td style={{ padding: "0.5rem", whiteSpace: "nowrap" }}>
                {office.latitude}, {office.longitude}
              </td>
              <td style={{ padding: "0.5rem" }}>{office.radiusMeters} m</td>
              <td style={{ padding: "0.5rem" }}>{office.timezone}</td>
              <td style={{ padding: "0.5rem", whiteSpace: "nowrap" }}>
                {office.workStart}–{office.workEnd}
              </td>
              <td style={{ padding: "0.5rem" }}>{office.isActive ? "Aktif" : "Nonaktif"}</td>
              <td style={{ padding: "0.5rem", whiteSpace: "nowrap" }}>
                <button
                  type="button"
                  onClick={() => edit(office)}
                  disabled={busy}
                  style={{ padding: "0.35rem 0.6rem", marginRight: "0.25rem" }}
                >
                  Edit
                </button>
                <button
                  type="button"
                  onClick={() => setActive(office, !office.isActive)}
                  disabled={busy}
                  style={{ padding: "0.35rem 0.6rem" }}
                >
                  {office.isActive ? "Nonaktifkan" : "Aktifkan"}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
