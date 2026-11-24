"use client";

import { useRouter } from "next/navigation";
import { useState, type ChangeEvent, type FormEvent } from "react";

const CSRF_COOKIE = "aos_csrf";

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

async function requestJson(
  url: string,
  method: "POST" | "PATCH" | "PUT",
  payload: unknown,
): Promise<Record<string, unknown>> {
  const token = await csrfToken();
  const response = await fetch(url, {
    method,
    credentials: "same-origin",
    headers: { "content-type": "application/json", "x-csrf-token": token },
    body: JSON.stringify(payload),
  });
  const body = (await response.json().catch(() => ({}))) as Record<string, unknown> & {
    error?: { message?: string };
  };
  if (!response.ok) throw new Error(body.error?.message ?? "Permintaan gagal");
  return body;
}

const currency = new Intl.NumberFormat("id-ID", {
  style: "currency",
  currency: "IDR",
  maximumFractionDigits: 0,
});

function dateLabel(value: string): string {
  return new Intl.DateTimeFormat("id-ID", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${value.slice(0, 10)}T00:00:00.000Z`));
}

type ClientRow = {
  id: string;
  name: string;
  picName: string;
  phone: string | null;
  address: string | null;
  latitude: number;
  longitude: number;
  radiusMeters: number;
  isActive: boolean;
};

export function ClientManager({
  workspaceId,
  clients,
  canManage,
}: {
  workspaceId: string;
  clients: ClientRow[];
  canManage: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [form, setForm] = useState({
    name: "",
    picName: "",
    phone: "",
    address: "",
    latitude: "-6.200000",
    longitude: "106.816666",
    radiusMeters: "100",
  });

  const visible = clients.filter((client) => {
    const q = query.trim().toLowerCase();
    return !q || client.name.toLowerCase().includes(q) || client.picName.toLowerCase().includes(q);
  });

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await requestJson(`/api/workspaces/${workspaceId}/clients`, "POST", {
        ...form,
        latitude: Number(form.latitude),
        longitude: Number(form.longitude),
        radiusMeters: Number(form.radiusMeters),
      });
      setNotice("Client berhasil ditambahkan.");
      setForm({ ...form, name: "", picName: "", phone: "", address: "" });
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Gagal menyimpan client");
    } finally {
      setBusy(false);
    }
  }

  async function toggle(client: ClientRow) {
    setBusy(true);
    setError(null);
    try {
      await requestJson(`/api/workspaces/${workspaceId}/clients/${client.id}`, "PATCH", {
        isActive: !client.isActive,
      });
      setNotice(client.isActive ? "Client dinonaktifkan." : "Client diaktifkan.");
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Gagal memperbarui client");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section>
      {error ? <p role="alert" className="alert">{error}</p> : null}
      {notice ? <p role="status" className="notice">{notice}</p> : null}
      {canManage ? (
        <form onSubmit={submit} className="form-card" aria-label="Tambah client">
          <div className="card-head" style={{ padding: "0 0 0.85rem", borderBottom: "none" }}>
            <div>
              <h2 className="section-title">Master client</h2>
              <p className="section-note">Titik koordinat dipakai untuk validasi radius kunjungan.</p>
            </div>
          </div>
          <div className="form-grid">
            <label className="field">Nama client<input required minLength={2} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
            <label className="field">PIC<input required minLength={2} value={form.picName} onChange={(e) => setForm({ ...form, picName: e.target.value })} /></label>
            <label className="field">Telepon<input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></label>
            <label className="field">Radius (meter)<input type="number" min={10} max={10000} value={form.radiusMeters} onChange={(e) => setForm({ ...form, radiusMeters: e.target.value })} /></label>
            <label className="field">Latitude<input required value={form.latitude} onChange={(e) => setForm({ ...form, latitude: e.target.value })} /></label>
            <label className="field">Longitude<input required value={form.longitude} onChange={(e) => setForm({ ...form, longitude: e.target.value })} /></label>
            <label className="field field--wide">Alamat<textarea value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} /></label>
            <div><button className="btn btn--primary" disabled={busy}>{busy ? "Menyimpan…" : "Tambah client"}</button></div>
          </div>
        </form>
      ) : null}

      <div className="toolbar">
        <label className="field">Cari client<input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Nama atau PIC" /></label>
      </div>
      <div className="table-wrap">
        <div className="table-head">
          <div><h2 className="section-title">Daftar client</h2><p className="section-note"><span className="num">{visible.length}</span> client</p></div>
          <span className="badge badge--green"><span className="num">{clients.filter((row) => row.isActive).length}</span> aktif</span>
        </div>
        <div className="table-scroll">
          <table className="data">
            <thead><tr><th>Client</th><th>PIC</th><th>Telepon</th><th>Koordinat</th><th>Radius</th><th>Status</th>{canManage ? <th>Aksi</th> : null}</tr></thead>
            <tbody>
              {visible.length === 0 ? <tr><td colSpan={7} className="empty">Belum ada client.</td></tr> : null}
              {visible.map((client) => (
                <tr key={client.id}>
                  <td><span className="cell-title">{client.name}</span><span className="cell-sub">{client.address ?? "Alamat belum diisi"}</span></td>
                  <td>{client.picName}</td>
                  <td className="mono">{client.phone ?? "—"}</td>
                  <td className="mono nowrap">{client.latitude.toFixed(5)}, {client.longitude.toFixed(5)}</td>
                  <td className="num">{client.radiusMeters} m</td>
                  <td><span className={client.isActive ? "badge badge--green" : "badge badge--neutral"}>{client.isActive ? "Aktif" : "Nonaktif"}</span></td>
                  {canManage ? <td><button type="button" className="btn btn--secondary btn--sm" onClick={() => toggle(client)} disabled={busy}>{client.isActive ? "Nonaktifkan" : "Aktifkan"}</button></td> : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

type ScheduleRow = {
  id: string;
  clientId: string;
  clientName: string;
  clientAddress: string | null;
  memberId: string;
  memberName: string;
  scheduledDate: string;
  plannedStartTime: string;
  plannedEndTime: string;
  purpose: string;
  status: string;
  checkInAt: string | null;
  checkOutAt: string | null;
  durationMinutes: number | null;
  validationStatus: string | null;
};

export function ScheduleManager({
  workspaceId,
  clients,
  members,
  schedules,
  canManage,
}: {
  workspaceId: string;
  clients: Array<{ id: string; name: string }>;
  members: Array<{ id: string; name: string }>;
  schedules: ScheduleRow[];
  canManage: boolean;
}) {
  const router = useRouter();
  const today = new Date().toISOString().slice(0, 10);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [form, setForm] = useState({
    clientId: clients[0]?.id ?? "",
    memberId: members[0]?.id ?? "",
    scheduledDate: today,
    plannedStartTime: "09:00",
    plannedEndTime: "11:00",
    purpose: "",
  });

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await requestJson(`/api/workspaces/${workspaceId}/client-visits`, "POST", form);
      setNotice("Jadwal kunjungan dibuat.");
      setForm({ ...form, purpose: "" });
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Gagal membuat jadwal");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section>
      {error ? <p role="alert" className="alert">{error}</p> : null}
      {notice ? <p role="status" className="notice">{notice}</p> : null}
      {canManage ? (
        <form onSubmit={submit} className="form-card" aria-label="Buat jadwal kunjungan">
          <div className="form-grid">
            <label className="field">Client<select value={form.clientId} onChange={(e) => setForm({ ...form, clientId: e.target.value })} required>{clients.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label>
            <label className="field">Karyawan<select value={form.memberId} onChange={(e) => setForm({ ...form, memberId: e.target.value })} required>{members.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label>
            <label className="field">Tanggal<input type="date" required value={form.scheduledDate} onChange={(e) => setForm({ ...form, scheduledDate: e.target.value })} /></label>
            <label className="field">Mulai<input type="time" required value={form.plannedStartTime} onChange={(e) => setForm({ ...form, plannedStartTime: e.target.value })} /></label>
            <label className="field">Selesai<input type="time" required value={form.plannedEndTime} onChange={(e) => setForm({ ...form, plannedEndTime: e.target.value })} /></label>
            <label className="field field--wide">Tujuan<textarea required minLength={3} value={form.purpose} onChange={(e) => setForm({ ...form, purpose: e.target.value })} /></label>
            <div><button className="btn btn--primary" disabled={busy || clients.length === 0 || members.length === 0}>{busy ? "Menyimpan…" : "Buat jadwal"}</button></div>
          </div>
        </form>
      ) : null}
      <div className="table-wrap">
        <div className="table-head"><div><h2 className="section-title">Jadwal kunjungan</h2><p className="section-note">Status dihitung dari check-in dan check-out di mobile.</p></div><span className="badge badge--neutral">{schedules.length} jadwal</span></div>
        <div className="table-scroll">
          <table className="data">
            <thead><tr><th>Tanggal</th><th>Client</th><th>Karyawan</th><th>Waktu</th><th>Status</th><th>Durasi</th><th>Validasi</th></tr></thead>
            <tbody>
              {schedules.length === 0 ? <tr><td colSpan={7} className="empty">Belum ada jadwal.</td></tr> : null}
              {schedules.map((row) => (
                <tr key={row.id}>
                  <td className="nowrap">{dateLabel(row.scheduledDate)}</td>
                  <td><span className="cell-title">{row.clientName}</span><span className="cell-sub">{row.purpose}</span></td>
                  <td>{row.memberName}</td>
                  <td className="mono nowrap">{row.plannedStartTime}–{row.plannedEndTime}</td>
                  <td><span className={row.status === "COMPLETED" ? "badge badge--green" : row.status === "CANCELLED" ? "badge badge--red" : "badge badge--yellow"}>{row.status}</span></td>
                  <td className="num">{row.durationMinutes === null ? "—" : `${row.durationMinutes} m`}</td>
                  <td>{row.validationStatus ? <span className={row.validationStatus === "OUT_OF_RADIUS" ? "badge badge--yellow" : "badge badge--neutral"}>{row.validationStatus}</span> : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

type LogRow = {
  id: string;
  clientName: string;
  memberName: string;
  type: string;
  timestampServer: string;
  distanceMeters: number | null;
  isInsideRadius: boolean | null;
  notes: string | null;
  durationMinutes: number | null;
  validationStatus: string;
  hasPhoto: boolean;
};

export function VisitLogTable({
  workspaceId,
  logs,
  canManage,
}: {
  workspaceId: string;
  logs: LogRow[];
  canManage: boolean;
}) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function review(logId: string, validationStatus: "VALID" | "VOID") {
    setBusyId(logId);
    setError(null);
    try {
      await requestJson(`/api/workspaces/${workspaceId}/client-visits/logs/${logId}/review`, "PATCH", { validationStatus });
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Gagal memvalidasi kunjungan");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="table-wrap">
      {error ? <p role="alert" className="alert" style={{ margin: "0.8rem" }}>{error}</p> : null}
      <div className="table-head"><div><h2 className="section-title">Log kunjungan</h2><p className="section-note">Foto privat hanya dapat dibuka pengguna berizin.</p></div><span className="badge badge--neutral">{logs.length} log</span></div>
      <div className="table-scroll">
        <table className="data">
          <thead><tr><th>Waktu</th><th>Client</th><th>Karyawan</th><th>Tipe</th><th>Jarak</th><th>Durasi</th><th>Status</th><th>Bukti</th>{canManage ? <th>Review</th> : null}</tr></thead>
          <tbody>
            {logs.length === 0 ? <tr><td colSpan={9} className="empty">Belum ada kunjungan.</td></tr> : null}
            {logs.map((log) => (
              <tr key={log.id}>
                <td className="mono nowrap">{new Intl.DateTimeFormat("id-ID", { dateStyle: "medium", timeStyle: "short" }).format(new Date(log.timestampServer))}</td>
                <td>{log.clientName}</td>
                <td>{log.memberName}</td>
                <td><span className="badge badge--neutral">{log.type}</span></td>
                <td className="num" style={{ color: log.isInsideRadius === false ? "var(--danger)" : undefined }}>{log.distanceMeters === null ? "—" : `${log.distanceMeters} m`}</td>
                <td className="num">{log.durationMinutes === null ? "—" : `${log.durationMinutes} m`}</td>
                <td><span className={log.validationStatus === "OUT_OF_RADIUS" ? "badge badge--yellow" : log.validationStatus === "VOID" ? "badge badge--red" : "badge badge--green"}>{log.validationStatus}</span></td>
                <td>{log.hasPhoto ? <a href={`/api/workspaces/${workspaceId}/client-visits/logs/${log.id}/photo`} target="_blank" rel="noreferrer" style={{ display: "inline-flex", alignItems: "center", gap: "0.45rem" }}><img src={`/api/workspaces/${workspaceId}/client-visits/logs/${log.id}/photo`} alt={`Foto kunjungan ${log.clientName}`} width={38} height={38} loading="lazy" style={{ width: 38, height: 38, objectFit: "cover", borderRadius: 6, border: "1px solid #E2E8E4" }} />Lihat foto</a> : "—"}</td>
                {canManage ? (
                  <td><div className="btn-row"><button className="btn btn--secondary btn--sm" disabled={busyId === log.id} onClick={() => review(log.id, "VALID")}>Valid</button><button className="btn btn--danger btn--sm" disabled={busyId === log.id} onClick={() => review(log.id, "VOID")}>Void</button></div></td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function ClientVisitMap({ clients }: { clients: ClientRow[] }) {
  const [selected, setSelected] = useState<string | null>(clients[0]?.id ?? null);
  const active = clients.filter((client) => client.isActive);
  if (active.length === 0) {
    return <p className="empty card card-pad">Belum ada client aktif dengan koordinat.</p>;
  }
  const lats = active.map((client) => client.latitude);
  const lngs = active.map((client) => client.longitude);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);
  const latSpan = Math.max(0.002, maxLat - minLat);
  const lngSpan = Math.max(0.002, maxLng - minLng);
  const point = (client: ClientRow) => ({
    x: 50 + ((client.longitude - minLng) / lngSpan) * 700,
    y: 370 - ((client.latitude - minLat) / latSpan) * 320,
  });
  const chosen = active.find((client) => client.id === selected) ?? active[0]!;

  return (
    <div className="stack-lg">
      <div className="card" style={{ overflow: "hidden" }}>
        <div className="card-head"><div><h2 className="section-title">Peta koordinat &amp; radius</h2><p className="section-note">Visualisasi SVG tanpa layanan peta eksternal.</p></div><span className="badge badge--green">{active.length} titik</span></div>
        <svg viewBox="0 0 800 420" role="img" aria-label="Peta sebaran client" style={{ width: "100%", height: "auto", display: "block", background: "#f7f9f8" }}>
          <defs><pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse"><path d="M 40 0 L 0 0 0 40" fill="none" stroke="#e2e8e4" strokeWidth="1" /></pattern></defs>
          <rect width="800" height="420" fill="url(#grid)" />
          {active.map((client) => {
            const p = point(client);
            const r = Math.max(8, Math.min(40, client.radiusMeters / 25));
            return (
              <g key={client.id} onClick={() => setSelected(client.id)} style={{ cursor: "pointer" }}>
                <circle cx={p.x} cy={p.y} r={r} fill={selected === client.id ? "rgba(21,128,61,0.18)" : "rgba(234,179,8,0.14)"} stroke={selected === client.id ? "#15803d" : "#eab308"} strokeWidth="1.5" />
                <circle cx={p.x} cy={p.y} r="5" fill={selected === client.id ? "#15803d" : "#eab308"} stroke="#ffffff" strokeWidth="2" />
                <text x={p.x + 9} y={p.y - 8} fontSize="11" fontWeight="600" fill="#0f172a">{client.name}</text>
              </g>
            );
          })}
        </svg>
      </div>
      <div className="table-wrap">
        <div className="table-head"><div><h2 className="section-title">{chosen.name}</h2><p className="section-note">{chosen.address ?? "Alamat belum diisi"} · {chosen.picName} · {chosen.phone ?? "—"}</p></div><span className="badge badge--yellow">Radius {chosen.radiusMeters} m</span></div>
        <div className="table-scroll"><table className="data"><thead><tr><th>Client</th><th>Latitude</th><th>Longitude</th><th>Radius</th><th>Status</th></tr></thead><tbody>{active.map((client) => <tr key={client.id} onClick={() => setSelected(client.id)} style={{ cursor: "pointer" }}><td><span className="cell-title">{client.name}</span></td><td className="mono">{client.latitude.toFixed(6)}</td><td className="mono">{client.longitude.toFixed(6)}</td><td className="num">{client.radiusMeters} m</td><td><span className="badge badge--green">Aktif</span></td></tr>)}</tbody></table></div>
      </div>
    </div>
  );
}

export function VisitSettingsForm({
  workspaceId,
  initial,
  canManage,
}: {
  workspaceId: string;
  initial: { defaultRadiusMeters: number; requirePhoto: boolean; requireCheckout: boolean; allowOutsideRadius: boolean };
  canManage: boolean;
}) {
  const router = useRouter();
  const [form, setForm] = useState({ ...initial, defaultRadiusMeters: String(initial.defaultRadiusMeters) });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await requestJson(`/api/workspaces/${workspaceId}/client-visits/settings`, "PATCH", {
        ...form,
        defaultRadiusMeters: Number(form.defaultRadiusMeters),
      });
      setNotice("Pengaturan kunjungan disimpan.");
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Gagal menyimpan pengaturan");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={save} className="form-card">
      {error ? <p role="alert" className="alert">{error}</p> : null}
      {notice ? <p role="status" className="notice">{notice}</p> : null}
      <div className="form-grid">
        <label className="field">Radius default (meter)<input type="number" min={10} max={10000} value={form.defaultRadiusMeters} onChange={(e) => setForm({ ...form, defaultRadiusMeters: e.target.value })} disabled={!canManage} /></label>
        <label className="field--check"><input type="checkbox" checked={form.requirePhoto} onChange={(e) => setForm({ ...form, requirePhoto: e.target.checked })} disabled={!canManage} /> Wajib foto bukti</label>
        <label className="field--check"><input type="checkbox" checked={form.requireCheckout} onChange={(e) => setForm({ ...form, requireCheckout: e.target.checked })} disabled={!canManage} /> Wajib check-out</label>
        <label className="field--check"><input type="checkbox" checked={form.allowOutsideRadius} onChange={(e) => setForm({ ...form, allowOutsideRadius: e.target.checked })} disabled={!canManage} /> Izinkan check-in luar radius (ditandai)</label>
      </div>
      {canManage ? <div className="btn-row" style={{ marginTop: "0.9rem" }}><button className="btn btn--primary" disabled={busy}>{busy ? "Menyimpan…" : "Simpan pengaturan"}</button></div> : null}
    </form>
  );
}

type ProjectionRow = {
  id: string;
  memberId: string;
  memberName: string;
  divisionName: string | null;
  title: string;
  description: string | null;
  periodType: string;
  startDate: string;
  endDate: string;
  progress: number;
  status: string;
  blockerNote: string | null;
  reviewNote: string | null;
  reviewedAt: string | null;
};

export function ProjectionReview({ workspaceId, projections, canManage }: { workspaceId: string; projections: ProjectionRow[]; canManage: boolean }) {
  const router = useRouter();
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function review(id: string) {
    setBusyId(id);
    setError(null);
    try {
      await requestJson(`/api/workspaces/${workspaceId}/work-projections/${id}/review`, "PATCH", { reviewNote: notes[id] ?? "" }).catch(async (caught) => {
        // Endpoint review berada pada route yang sama dengan data proyeksi.
        throw caught;
      });
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Gagal menyimpan review");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="table-wrap">
      {error ? <p role="alert" className="alert" style={{ margin: "0.8rem" }}>{error}</p> : null}
      <div className="table-head"><div><h2 className="section-title">Proyeksi pekerjaan</h2><p className="section-note">Target harian/mingguan beserta progres dan kendala.</p></div><span className="badge badge--neutral">{projections.length} proyeksi</span></div>
      <div className="table-scroll">
        <table className="data">
          <thead><tr><th>Karyawan</th><th>Target</th><th>Periode</th><th>Progres</th><th>Status</th><th>Kendala</th>{canManage ? <th>Review atasan</th> : null}</tr></thead>
          <tbody>
            {projections.length === 0 ? <tr><td colSpan={7} className="empty">Belum ada proyeksi pekerjaan.</td></tr> : null}
            {projections.map((row) => (
              <tr key={row.id}>
                <td><span className="cell-title">{row.memberName}</span><span className="cell-sub">{row.divisionName ?? "Tanpa divisi"}</span></td>
                <td><span className="cell-title">{row.title}</span><span className="cell-sub">{row.description ?? "—"}</span></td>
                <td className="nowrap">{row.periodType === "DAILY" ? "Harian" : "Mingguan"}<span className="cell-sub">{dateLabel(row.startDate)}–{dateLabel(row.endDate)}</span></td>
                <td><div className="bar-row"><div className="bar-track"><div className="bar-fill" style={{ width: `${row.progress}%` }} /></div><span className="bar-count">{row.progress}%</span></div></td>
                <td><span className={row.status === "COMPLETED" ? "badge badge--green" : row.status === "BLOCKED" ? "badge badge--red" : "badge badge--yellow"}>{row.status}</span></td>
                <td className="muted">{row.blockerNote ?? "—"}</td>
                {canManage ? <td><div className="stack">{row.reviewNote ? <span className="cell-sub">{row.reviewNote}</span> : null}<input className="select-inline" placeholder="Catatan review" value={notes[row.id] ?? ""} onChange={(e) => setNotes({ ...notes, [row.id]: e.target.value })} /><button className="btn btn--secondary btn--sm" disabled={busyId === row.id} onClick={() => review(row.id)}>Simpan review</button></div></td> : null}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

type PayrollSetting = {
  currency: string;
  baseSalary: number;
  attendanceAllowance: number;
  transportAllowance: number;
  mealAllowance: number;
  overtimeHourlyRate: number;
  lateDeductionPerMinute: number;
  lateDeductionPerIncident: number;
  sp1Deduction: number;
  sp2Deduction: number;
  sp3Deduction: number;
};

const PAYROLL_FIELDS: Array<{ key: keyof PayrollSetting; label: string }> = [
  { key: "baseSalary", label: "Gaji pokok default" },
  { key: "attendanceAllowance", label: "Tunjangan hadir" },
  { key: "transportAllowance", label: "Tunjangan transport" },
  { key: "mealAllowance", label: "Tunjangan makan" },
  { key: "overtimeHourlyRate", label: "Tarif lembur / jam" },
  { key: "lateDeductionPerMinute", label: "Potongan telat / menit" },
  { key: "lateDeductionPerIncident", label: "Potongan telat / kejadian" },
  { key: "sp1Deduction", label: "Potongan SP1" },
  { key: "sp2Deduction", label: "Potongan SP2" },
  { key: "sp3Deduction", label: "Potongan SP3" },
];

export function PayrollSettingsForm({ workspaceId, initial }: { workspaceId: string; initial: PayrollSetting }) {
  const router = useRouter();
  const [form, setForm] = useState<Record<string, string>>(Object.fromEntries(PAYROLL_FIELDS.map((field) => [field.key, String(initial[field.key])])));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await requestJson(`/api/workspaces/${workspaceId}/payroll/settings`, "PATCH", Object.fromEntries(PAYROLL_FIELDS.map((field) => [field.key, Number(form[field.key] ?? 0)])));
      setNotice("Pengaturan gaji disimpan.");
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Gagal menyimpan pengaturan gaji");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={save} className="form-card">
      {error ? <p role="alert" className="alert">{error}</p> : null}
      {notice ? <p role="status" className="notice">{notice}</p> : null}
      <div className="form-grid">
        {PAYROLL_FIELDS.map((field) => (
          <label className="field" key={field.key}>{field.label}<input type="number" min={0} value={form[field.key] ?? "0"} onChange={(e) => setForm({ ...form, [field.key]: e.target.value })} /></label>
        ))}
      </div>
      <div className="btn-row" style={{ marginTop: "0.9rem" }}><button className="btn btn--primary" disabled={busy}>{busy ? "Menyimpan…" : "Simpan pengaturan gaji"}</button></div>
    </form>
  );
}

type CompensationRow = {
  id: string | null;
  memberId: string;
  memberName: string;
  memberEmail: string;
  divisionName: string | null;
  baseSalary: number | null;
  attendanceAllowance: number | null;
  transportAllowance: number | null;
  mealAllowance: number | null;
  overtimeHourlyRate: number | null;
  effectiveFrom: string | null;
  notes: string | null;
};

export function CompensationManager({ workspaceId, rows }: { workspaceId: string; rows: CompensationRow[] }) {
  const router = useRouter();
  const [drafts, setDrafts] = useState<Record<string, Record<string, string>>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const fields: Array<{ key: keyof CompensationRow; label: string }> = [
    { key: "baseSalary", label: "Gaji pokok" },
    { key: "attendanceAllowance", label: "Hadir" },
    { key: "transportAllowance", label: "Transport" },
    { key: "mealAllowance", label: "Makan" },
    { key: "overtimeHourlyRate", label: "Lembur/jam" },
  ];

  function draft(row: CompensationRow): Record<string, string> {
    return drafts[row.memberId] ?? Object.fromEntries(fields.map((field) => [field.key, row[field.key] === null ? "" : String(row[field.key])]));
  }

  async function save(row: CompensationRow) {
    setBusyId(row.memberId);
    setError(null);
    setNotice(null);
    try {
      const values = draft(row);
      await requestJson(`/api/workspaces/${workspaceId}/payroll/compensations/${row.memberId}`, "PUT", {
        ...Object.fromEntries(fields.map((field) => [field.key, values[field.key] === "" ? null : Number(values[field.key])])),
        notes: row.notes,
      });
      setNotice(`Kompensasi ${row.memberName} disimpan.`);
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Gagal menyimpan kompensasi");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="table-wrap">
      {error ? <p role="alert" className="alert" style={{ margin: "0.8rem" }}>{error}</p> : null}
      {notice ? <p role="status" className="notice" style={{ margin: "0.8rem" }}>{notice}</p> : null}
      <div className="table-head"><div><h2 className="section-title">Kompensasi per karyawan</h2><p className="section-note">Kosongkan untuk memakai nilai default pengaturan gaji.</p></div><span className="badge badge--neutral">{rows.length} karyawan</span></div>
      <div className="table-scroll">
        <table className="data">
          <thead><tr><th>Karyawan</th>{fields.map((field) => <th key={field.key}>{field.label}</th>)}<th>Aksi</th></tr></thead>
          <tbody>
            {rows.map((row) => {
              const values = draft(row);
              return (
                <tr key={row.memberId}>
                  <td><span className="cell-title">{row.memberName}</span><span className="cell-sub">{row.divisionName ?? row.memberEmail}</span></td>
                  {fields.map((field) => <td key={field.key}><input className="select-inline" type="number" min={0} placeholder="Default" value={values[field.key] ?? ""} onChange={(e) => setDrafts({ ...drafts, [row.memberId]: { ...values, [field.key]: e.target.value } })} /></td>)}
                  <td><button className="btn btn--secondary btn--sm" disabled={busyId === row.memberId} onClick={() => save(row)}>Simpan</button></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

type CalculationItem = {
  memberId: string;
  memberName: string;
  divisionName: string | null;
  baseSalary: number;
  attendanceAllowance: number;
  transportAllowance: number;
  mealAllowance: number;
  overtimeMinutes: number;
  overtimePay: number;
  lateMinutes: number;
  lateIncidents: number;
  lateDeduction: number;
  spLevel: string | null;
  spDeduction: number;
  leaveDays: number;
  permitDays: number;
  grossPay: number;
  totalDeductions: number;
  netPay: number;
};

type Calculation = { year: number; month: number; currency: string; items: CalculationItem[]; totals: { memberCount: number; totalGross: number; totalDeductions: number; totalNet: number } };

export function PayrollGenerateForm({ workspaceId, year, month }: { workspaceId: string; year: number; month: number }) {
  const router = useRouter();
  const [period, setPeriod] = useState({ year: String(year), month: String(month), notes: "" });
  const [preview, setPreview] = useState<Calculation | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function loadPreview() {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(`/api/workspaces/${workspaceId}/payroll/preview?year=${period.year}&month=${period.month}`, { credentials: "same-origin" });
      const body = (await response.json()) as Calculation & { error?: { message?: string } };
      if (!response.ok) throw new Error(body.error?.message ?? "Gagal menghitung preview");
      setPreview(body);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Gagal menghitung preview");
    } finally {
      setBusy(false);
    }
  }

  async function generate() {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await requestJson(`/api/workspaces/${workspaceId}/payroll/runs`, "POST", { year: Number(period.year), month: Number(period.month), notes: period.notes });
      setNotice("Payroll DRAFT berhasil dibuat. Finalkan setelah memeriksa rincian.");
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Gagal membuat payroll");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section>
      {error ? <p role="alert" className="alert">{error}</p> : null}
      {notice ? <p role="status" className="notice">{notice}</p> : null}
      <div className="form-card">
        <div className="form-grid">
          <label className="field">Tahun<input type="number" min={2000} max={2100} value={period.year} onChange={(e) => setPeriod({ ...period, year: e.target.value })} /></label>
          <label className="field">Bulan<select value={period.month} onChange={(e) => setPeriod({ ...period, month: e.target.value })}>{Array.from({ length: 12 }, (_, index) => index + 1).map((value) => <option key={value} value={value}>{new Intl.DateTimeFormat("id-ID", { month: "long" }).format(new Date(Date.UTC(2024, value - 1, 1)))}</option>)}</select></label>
          <label className="field field--wide">Catatan<input value={period.notes} onChange={(e) => setPeriod({ ...period, notes: e.target.value })} placeholder="Opsional" maxLength={1000} /></label>
          <div className="btn-row"><button type="button" className="btn btn--secondary" onClick={loadPreview} disabled={busy}>Preview perhitungan</button><button type="button" className="btn btn--primary" onClick={generate} disabled={busy}>Generate DRAFT</button></div>
        </div>
      </div>
      {preview ? (
        <div className="table-wrap">
          <div className="table-head"><div><h2 className="section-title">Preview {preview.month}/{preview.year}</h2><p className="section-note">Kehadiran, keterlambatan, lembur, cuti/izin, dan SP aktif.</p></div><span className="badge badge--yellow">{preview.totals.memberCount} karyawan</span></div>
          <div className="table-scroll">
            <table className="data">
              <thead><tr><th>Karyawan</th><th>Gaji pokok</th><th>Hadir</th><th>Transport</th><th>Makan</th><th>Lembur</th><th>Potongan</th><th>Net</th></tr></thead>
              <tbody>{preview.items.map((item) => <tr key={item.memberId}><td><span className="cell-title">{item.memberName}</span><span className="cell-sub">{item.divisionName ?? "—"} · telat {item.lateMinutes} m · cuti {item.leaveDays} h · izin {item.permitDays} h{item.spLevel ? ` · ${item.spLevel}` : ""}</span></td><td className="num">{currency.format(item.baseSalary)}</td><td className="num">{currency.format(item.attendanceAllowance)}</td><td className="num">{currency.format(item.transportAllowance)}</td><td className="num">{currency.format(item.mealAllowance)}</td><td className="num">{currency.format(item.overtimePay)}</td><td className="num">{currency.format(item.totalDeductions)}</td><td className="num"><strong>{currency.format(item.netPay)}</strong></td></tr>)}</tbody>
              <tfoot><tr><td>Total</td><td colSpan={5} /><td className="num">{currency.format(preview.totals.totalDeductions)}</td><td className="num">{currency.format(preview.totals.totalNet)}</td></tr></tfoot>
            </table>
          </div>
        </div>
      ) : null}
    </section>
  );
}

export function PayrollRunActions({ workspaceId, runId, status }: { workspaceId: string; runId: string; status: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function finalize() {
    setBusy(true);
    setError(null);
    try {
      await requestJson(`/api/workspaces/${workspaceId}/payroll/runs/${runId}/finalize`, "POST", {});
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Gagal finalisasi");
    } finally {
      setBusy(false);
    }
  }

  async function pay() {
    const reference = window.prompt("Referensi pembayaran (mis. transfer bank / nomor batch):");
    if (!reference) return;
    setBusy(true);
    setError(null);
    try {
      await requestJson(`/api/workspaces/${workspaceId}/payroll/runs/${runId}/pay`, "POST", { paymentReference: reference });
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Gagal mencatat pembayaran");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack">
      {status === "DRAFT" ? <button className="btn btn--primary btn--sm" disabled={busy} onClick={finalize}>Finalisasi</button> : null}
      {status === "FINALIZED" ? <button className="btn btn--accent btn--sm" disabled={busy} onClick={pay}>Konfirmasi bayar</button> : null}
      {status === "PAID" ? <span className="badge badge--green">Lunas</span> : null}
      {error ? <span role="alert" className="cell-sub" style={{ color: "var(--danger)" }}>{error}</span> : null}
    </div>
  );
}

export function CompanyProfileForm({
  workspaceId,
  initial,
}: {
  workspaceId: string;
  initial: { legalName: string; address: string | null; contactEmail: string | null; contactPhone: string | null; logoUrl: string | null };
}) {
  const router = useRouter();
  const [form, setForm] = useState({
    legalName: initial.legalName,
    address: initial.address ?? "",
    contactEmail: initial.contactEmail ?? "",
    contactPhone: initial.contactPhone ?? "",
  });
  const [logoUrl, setLogoUrl] = useState(initial.logoUrl);
  const [busy, setBusy] = useState(false);
  const [logoBusy, setLogoBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await requestJson(`/api/workspaces/${workspaceId}/settings/company`, "PATCH", form);
      setNotice("Profil perusahaan disimpan.");
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Gagal menyimpan profil");
    } finally {
      setBusy(false);
    }
  }

  async function uploadLogo(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      setError("Logo maksimal 2 MB.");
      return;
    }
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) {
      setError("Logo harus berupa PNG, JPG, atau WebP.");
      return;
    }
    setLogoBusy(true);
    setError(null);
    setNotice(null);
    try {
      const token = await csrfToken();
      const data = new FormData();
      data.append("logo", file);
      const response = await fetch(
        `/api/workspaces/${workspaceId}/settings/company/logo`,
        {
          method: "POST",
          credentials: "same-origin",
          headers: { "x-csrf-token": token },
          body: data,
        },
      );
      const body = (await response.json().catch(() => ({}))) as {
        logoUrl?: string;
        error?: { message?: string };
      };
      if (!response.ok || !body.logoUrl) {
        setError(body.error?.message ?? "Logo gagal diunggah.");
        return;
      }
      setLogoUrl(`${body.logoUrl}?v=${Date.now()}`);
      setNotice("Logo perusahaan diperbarui.");
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Logo gagal diunggah.");
    } finally {
      setLogoBusy(false);
    }
  }

  async function removeLogo() {
    if (!logoUrl || !window.confirm("Hapus logo perusahaan?")) return;
    setLogoBusy(true);
    setError(null);
    setNotice(null);
    try {
      const token = await csrfToken();
      const response = await fetch(
        `/api/workspaces/${workspaceId}/settings/company/logo`,
        {
          method: "DELETE",
          credentials: "same-origin",
          headers: { "x-csrf-token": token },
        },
      );
      const body = (await response.json().catch(() => ({}))) as {
        error?: { message?: string };
      };
      if (!response.ok) {
        setError(body.error?.message ?? "Logo gagal dihapus.");
        return;
      }
      setLogoUrl(null);
      setNotice("Logo perusahaan dihapus.");
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Logo gagal dihapus.");
    } finally {
      setLogoBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="form-card">
      {error ? <p role="alert" className="alert">{error}</p> : null}
      {notice ? <p role="status" className="notice">{notice}</p> : null}
      <div className="company-logo-row">
        <div className="company-logo-preview">
          {logoUrl ? <img src={logoUrl} alt="Logo perusahaan" /> : <span>Logo</span>}
        </div>
        <div className="stack">
          <div>
            <p className="section-title">Logo perusahaan</p>
            <p className="section-note">PNG, JPG, atau WebP maksimal 2 MB.</p>
          </div>
          <div className="btn-row">
            <label className="btn btn--secondary btn--sm" aria-disabled={logoBusy}>
              {logoBusy ? "Memproses…" : "Upload Logo"}
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                onChange={uploadLogo}
                disabled={logoBusy}
                style={{ display: "none" }}
              />
            </label>
            {logoUrl ? (
              <button type="button" className="btn btn--danger btn--sm" onClick={removeLogo} disabled={logoBusy}>
                Hapus Logo
              </button>
            ) : null}
          </div>
        </div>
      </div>
      <div className="form-grid">
        <label className="field field--wide">Nama resmi<input required minLength={2} value={form.legalName} onChange={(e) => setForm({ ...form, legalName: e.target.value })} /></label>
        <label className="field field--wide">Alamat<textarea value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} /></label>
        <label className="field">Email kontak<input type="email" value={form.contactEmail} onChange={(e) => setForm({ ...form, contactEmail: e.target.value })} /></label>
        <label className="field">Telepon<input value={form.contactPhone} onChange={(e) => setForm({ ...form, contactPhone: e.target.value })} /></label>
      </div>
      <div className="btn-row" style={{ marginTop: "0.9rem" }}><button className="btn btn--primary" disabled={busy}>{busy ? "Menyimpan…" : "Simpan profil"}</button></div>
    </form>
  );
}

export function AdminRoleManager({ workspaceId, members, currentMemberId }: { workspaceId: string; members: Array<{ id: string; name: string; email: string; roleKeys: string[]; status: string }>; currentMemberId: string }) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const roles = ["HR", "MANAGER", "SUPERVISOR", "EMPLOYEE"];

  async function change(memberId: string, role: string) {
    setBusyId(memberId);
    setError(null);
    setNotice(null);
    try {
      await requestJson(`/api/workspaces/${workspaceId}/members/${memberId}/role`, "PATCH", { role });
      setNotice("Role admin diperbarui.");
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Gagal mengubah role");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="table-wrap">
      {error ? <p role="alert" className="alert" style={{ margin: "0.8rem" }}>{error}</p> : null}
      {notice ? <p role="status" className="notice" style={{ margin: "0.8rem" }}>{notice}</p> : null}
      <div className="table-head"><div><h2 className="section-title">Akun admin workspace</h2><p className="section-note">Owner tidak dapat diturunkan dari halaman ini.</p></div><span className="badge badge--neutral">{members.length} akun</span></div>
      <div className="table-scroll"><table className="data"><thead><tr><th>Nama</th><th>Email</th><th>Role saat ini</th><th>Ubah role</th></tr></thead><tbody>{members.map((member) => <tr key={member.id}><td><span className="cell-title">{member.name}</span><span className="cell-sub">{member.status}</span></td><td className="muted">{member.email}</td><td className="mono">{member.roleKeys.join(", ")}</td><td>{member.id === currentMemberId || member.roleKeys.includes("WORKSPACE_OWNER") ? <span className="badge badge--green">Owner</span> : <select className="select-inline" defaultValue={member.roleKeys[0] ?? "EMPLOYEE"} disabled={busyId === member.id} onChange={(e) => change(member.id, e.target.value)}>{roles.map((role) => <option key={role} value={role}>{role}</option>)}</select>}</td></tr>)}</tbody></table></div>
    </div>
  );
}

export function PrintButton() {
  return <button type="button" className="btn btn--primary" onClick={() => window.print()}>Cetak slip</button>;
}
