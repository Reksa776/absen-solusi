"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

const CSRF_COOKIE = "aos_csrf";
const COORDINATE = "(-?\\d{1,3}(?:\\.\\d+)?)";

type Office = {
  id: string;
  name: string;
  address: string | null;
  latitude: number;
  longitude: number;
  googleMapsUrl: string | null;
  radiusMeters: number;
  timezone: string;
  workStart: string;
  workEnd: string;
  isActive: boolean;
};

type FormState = {
  name: string;
  address: string;
  googleMapsUrl: string;
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
  googleMapsUrl: "",
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

function extractCoordinates(value: string): { latitude: number; longitude: number } | null {
  const patterns = [
    new RegExp(`[?&](?:q|query|ll)=${COORDINATE},${COORDINATE}`, "i"),
    new RegExp(`@${COORDINATE},${COORDINATE}`, "i"),
    new RegExp(`!3d${COORDINATE}!4d${COORDINATE}`, "i"),
  ];
  for (const pattern of patterns) {
    const match = value.match(pattern);
    if (!match) continue;
    const latitude = Number(match[1]);
    const longitude = Number(match[2]);
    if (
      Number.isFinite(latitude) &&
      Number.isFinite(longitude) &&
      latitude >= -90 &&
      latitude <= 90 &&
      longitude >= -180 &&
      longitude <= 180
    ) {
      return { latitude, longitude };
    }
  }
  return null;
}

function validCoordinates(latitude: string, longitude: string): boolean {
  const lat = Number(latitude);
  const lng = Number(longitude);
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= -90 &&
    lat <= 90 &&
    lng >= -180 &&
    lng <= 180
  );
}

function mapEmbed(latitude: string, longitude: string): string {
  return `https://www.google.com/maps?q=${encodeURIComponent(latitude)},${encodeURIComponent(longitude)}&z=17&output=embed`;
}

function mapLink(office: Office): string {
  return (
    office.googleMapsUrl ??
    `https://www.google.com/maps?q=${office.latitude},${office.longitude}`
  );
}

function toForm(office: Office): FormState {
  return {
    name: office.name,
    address: office.address ?? "",
    googleMapsUrl: office.googleMapsUrl ?? "",
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

  function updateMapsUrl(value: string) {
    const coordinates = extractCoordinates(value);
    setForm((current) => ({
      ...current,
      googleMapsUrl: value,
      ...(coordinates
        ? {
            latitude: String(coordinates.latitude),
            longitude: String(coordinates.longitude),
          }
        : {}),
    }));
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
            googleMapsUrl: form.googleMapsUrl.trim() || null,
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
      const response = await fetch(`/api/workspaces/${workspaceId}/office/${office.id}`, {
        method: "PATCH",
        credentials: "same-origin",
        headers: { "content-type": "application/json", "x-csrf-token": token },
        body: JSON.stringify({ isActive }),
      });
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

  const canPreview = validCoordinates(form.latitude, form.longitude);
  const previewUrl = canPreview ? mapEmbed(form.latitude, form.longitude) : null;

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

      <form onSubmit={submit} className="form-card">
        <div className="table-head" style={{ padding: "0 0 0.85rem", borderBottom: "none" }}>
          <div>
            <h2 className="section-title">{editingId ? "Edit kantor" : "Tambah kantor"}</h2>
            <p className="section-note">
              Tempel shareloc WhatsApp; koordinat diisi otomatis dari tautan Google Maps.
            </p>
          </div>
        </div>
        <div className="form-grid">
          <label className="field">
            Nama kantor
            <input
              required
              maxLength={120}
              value={form.name}
              onChange={(event) => update("name", event.target.value)}
            />
          </label>
          <label className="field">
            Alamat
            <input
              maxLength={255}
              value={form.address}
              onChange={(event) => update("address", event.target.value)}
            />
          </label>
          <label className="field field--wide">
            Tempel URL Google Maps (Shareloc WA)
            <input
              type="url"
              maxLength={1024}
              placeholder="https://www.google.com/maps?q=-6.7320,108.5523"
              value={form.googleMapsUrl}
              onChange={(event) => updateMapsUrl(event.target.value)}
            />
          </label>
          <label className="field">
            Latitude
            <input
              required
              type="number"
              step="any"
              min={-90}
              max={90}
              className="mono"
              value={form.latitude}
              onChange={(event) => update("latitude", event.target.value)}
            />
          </label>
          <label className="field">
            Longitude
            <input
              required
              type="number"
              step="any"
              min={-180}
              max={180}
              className="mono"
              value={form.longitude}
              onChange={(event) => update("longitude", event.target.value)}
            />
          </label>
          <label className="field">
            Radius (meter)
            <input
              required
              type="number"
              min={10}
              max={5000}
              className="mono"
              value={form.radiusMeters}
              onChange={(event) => update("radiusMeters", event.target.value)}
            />
          </label>
          <label className="field">
            Timezone (IANA)
            <input
              required
              maxLength={64}
              value={form.timezone}
              onChange={(event) => update("timezone", event.target.value)}
            />
          </label>
          <label className="field">
            Jam masuk
            <input
              required
              type="time"
              className="mono"
              value={form.workStart}
              onChange={(event) => update("workStart", event.target.value)}
            />
          </label>
          <label className="field">
            Jam pulang
            <input
              required
              type="time"
              className="mono"
              value={form.workEnd}
              onChange={(event) => update("workEnd", event.target.value)}
            />
          </label>
          <label className="field--check">
            <input
              type="checkbox"
              checked={form.isActive}
              onChange={(event) => update("isActive", event.target.checked)}
            />
            Aktif
          </label>
          <div className="btn-row">
            <button type="submit" className="btn btn--primary" disabled={busy}>
              {busy ? "Memproses…" : editingId ? "Simpan perubahan" : "Tambah kantor"}
            </button>
            {editingId ? (
              <button type="button" className="btn btn--secondary" onClick={reset} disabled={busy}>
                Batal
              </button>
            ) : null}
          </div>
        </div>
      </form>

      {previewUrl ? (
        <div className="map-card">
          <div className="card-head" style={{ padding: "0 0 0.7rem", borderBottom: "none" }}>
            <div>
              <h2 className="section-title">Preview titik lokasi</h2>
              <p className="section-note mono">
                {Number(form.latitude).toFixed(6)}, {Number(form.longitude).toFixed(6)}
              </p>
            </div>
            <a
              href={`https://www.google.com/maps?q=${form.latitude},${form.longitude}`}
              target="_blank"
              rel="noreferrer"
              className="btn btn--secondary btn--sm"
            >
              Buka di Google Maps
            </a>
          </div>
          <iframe
            title="Preview lokasi kantor"
            src={previewUrl}
            loading="lazy"
            referrerPolicy="no-referrer-when-downgrade"
            className="map-frame"
          />
        </div>
      ) : null}

      <div className="table-wrap">
        <div className="table-head">
          <div>
            <h2 className="section-title">Daftar kantor</h2>
            <p className="section-note">{offices.length} lokasi terdaftar</p>
          </div>
        </div>
        <div className="table-scroll">
          <table className="data">
            <thead>
              <tr>
                {["Nama", "Alamat", "Koordinat", "Radius", "Timezone", "Jam", "Status", "Aksi"].map(
                  (label) => (
                    <th key={label}>{label}</th>
                  ),
                )}
              </tr>
            </thead>
            <tbody>
              {offices.length === 0 ? (
                <tr>
                  <td colSpan={8} className="empty">
                    Belum ada kantor. Tambahkan minimal satu agar check-in dapat dipakai.
                  </td>
                </tr>
              ) : null}
              {offices.map((office) => (
                <tr key={office.id}>
                  <td>
                    <span className="cell-title">{office.name}</span>
                  </td>
                  <td className="muted">{office.address ?? "—"}</td>
                  <td className="mono nowrap">
                    {office.latitude}, {office.longitude}
                  </td>
                  <td className="num">{office.radiusMeters} m</td>
                  <td>{office.timezone}</td>
                  <td className="mono nowrap">
                    {office.workStart}–{office.workEnd}
                  </td>
                  <td>
                    <span className={office.isActive ? "badge badge--green" : "badge badge--neutral"}>
                      {office.isActive ? "Aktif" : "Nonaktif"}
                    </span>
                  </td>
                  <td className="nowrap">
                    <div className="btn-row">
                      <a
                        href={mapLink(office)}
                        target="_blank"
                        rel="noreferrer"
                        className="btn btn--secondary btn--sm"
                      >
                        Peta
                      </a>
                      <button
                        type="button"
                        className="btn btn--secondary btn--sm"
                        onClick={() => edit(office)}
                        disabled={busy}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        className={office.isActive ? "btn btn--danger btn--sm" : "btn btn--primary btn--sm"}
                        onClick={() => setActive(office, !office.isActive)}
                        disabled={busy}
                      >
                        {office.isActive ? "Nonaktifkan" : "Aktifkan"}
                      </button>
                    </div>
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
