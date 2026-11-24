"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

const CSRF_COOKIE = "aos_csrf";

const PERMIT_TYPES = [
  { value: "SAKIT", label: "Sakit" },
  { value: "IZIN_PRIBADI", label: "Izin pribadi" },
  { value: "KEPERLUAN_KELUARGA", label: "Keperluan keluarga" },
  { value: "DINAS", label: "Dinas" },
  { value: "PULANG_CEPAT", label: "Pulang cepat" },
  { value: "DATANG_TERLAMBAT", label: "Datang terlambat" },
  { value: "LAINNYA", label: "Lainnya" },
] as const;

const LEAVE_TYPES = [
  { value: "CUTI_TAHUNAN", label: "Cuti tahunan" },
  { value: "CUTI_MELAHIRKAN", label: "Cuti melahirkan" },
  { value: "CUTI_KHUSUS", label: "Cuti khusus" },
  { value: "LAINNYA", label: "Lainnya" },
] as const;

type MemberOption = { id: string; name: string; divisionName?: string | null };

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

async function parseResponse(response: Response): Promise<Record<string, unknown>> {
  const body = (await response.json().catch(() => ({}))) as Record<string, unknown> & {
    error?: { message?: string };
  };
  if (!response.ok) throw new Error(body.error?.message ?? "Permintaan gagal");
  return body;
}

export function AdminPermitForm({
  workspaceId,
  members,
}: {
  workspaceId: string;
  members: MemberOption[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const token = await csrfToken();
      const response = await fetch(`/api/workspaces/${workspaceId}/permits`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "x-csrf-token": token },
        body: data,
      });
      await parseResponse(response);
      setNotice("Izin kerja berhasil dicatat.");
      form.reset();
      setOpen(false);
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Izin kerja gagal dicatat.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="stack" aria-label="Tambah izin kerja">
      <div className="toolbar">
        <button
          type="button"
          className="btn btn--primary"
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
        >
          {open ? "Tutup Form Izin" : "Tambah Izin Kerja"}
        </button>
      </div>
      {error ? <p role="alert" className="alert">{error}</p> : null}
      {notice ? <p role="status" className="notice">{notice}</p> : null}
      {open ? (
        <form onSubmit={submit} className="form-card" aria-label="Form Izin Kerja Admin">
          <div className="card-head" style={{ padding: "0 0 0.85rem", borderBottom: "none" }}>
            <div>
              <h2 className="section-title">Tambah Izin Kerja</h2>
              <p className="section-note">Input langsung oleh admin/HR. Bukti bersifat opsional.</p>
            </div>
          </div>
          <div className="form-grid">
            <label className="field">
              Nama karyawan
              <select name="memberId" required defaultValue="">
                <option value="" disabled>Pilih karyawan aktif</option>
                {members.map((member) => (
                  <option key={member.id} value={member.id}>
                    {member.name}{member.divisionName ? ` · ${member.divisionName}` : ""}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              Jenis izin
              <select name="permitType" required defaultValue="SAKIT">
                {PERMIT_TYPES.map((type) => (
                  <option key={type.value} value={type.value}>{type.label}</option>
                ))}
              </select>
            </label>
            <label className="field">
              Tanggal mulai
              <input type="date" name="startDate" required />
            </label>
            <label className="field">
              Tanggal selesai
              <input type="date" name="endDate" required />
            </label>
            <label className="field" style={{ gridColumn: "1 / -1" }}>
              Keterangan
              <textarea name="reason" required minLength={10} maxLength={1000} rows={3} />
            </label>
            <label className="field">
              Lampiran bukti (opsional)
              <input type="file" name="proof" accept="image/jpeg,image/png,image/webp,application/pdf" />
            </label>
            <label className="field">
              Status awal
              <select name="status" defaultValue="APPROVED">
                <option value="APPROVED">Langsung disetujui</option>
                <option value="PENDING">Menunggu persetujuan</option>
              </select>
            </label>
            <div className="btn-row">
              <button className="btn btn--primary" disabled={busy}>
                {busy ? "Menyimpan…" : "Simpan Izin"}
              </button>
            </div>
          </div>
        </form>
      ) : null}
    </section>
  );
}

export function AdminLeaveForm({
  workspaceId,
  members,
}: {
  workspaceId: string;
  members: MemberOption[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = Object.fromEntries(new FormData(form).entries());
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const token = await csrfToken();
      const response = await fetch(`/api/workspaces/${workspaceId}/leave`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json", "x-csrf-token": token },
        body: JSON.stringify(data),
      });
      await parseResponse(response);
      setNotice("Permohonan cuti berhasil dicatat.");
      form.reset();
      setOpen(false);
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Permohonan cuti gagal dicatat.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="stack" aria-label="Input permohonan cuti">
      <div className="toolbar">
        <button
          type="button"
          className="btn btn--primary"
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
        >
          {open ? "Tutup Form Cuti" : "Input Permohonan Cuti"}
        </button>
      </div>
      {error ? <p role="alert" className="alert">{error}</p> : null}
      {notice ? <p role="status" className="notice">{notice}</p> : null}
      {open ? (
        <form onSubmit={submit} className="form-card" aria-label="Form Permohonan Cuti Admin">
          <div className="card-head" style={{ padding: "0 0 0.85rem", borderBottom: "none" }}>
            <div>
              <h2 className="section-title">Input Permohonan Cuti</h2>
              <p className="section-note">
                Hari kerja dihitung dari pola kerja aktif dan kalender libur workspace.
              </p>
            </div>
          </div>
          <div className="form-grid">
            <label className="field">
              Nama karyawan
              <select name="memberId" required defaultValue="">
                <option value="" disabled>Pilih karyawan aktif</option>
                {members.map((member) => (
                  <option key={member.id} value={member.id}>
                    {member.name}{member.divisionName ? ` · ${member.divisionName}` : ""}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              Jenis cuti
              <select name="leaveType" required defaultValue="CUTI_TAHUNAN">
                {LEAVE_TYPES.map((type) => (
                  <option key={type.value} value={type.value}>{type.label}</option>
                ))}
              </select>
            </label>
            <label className="field">
              Tanggal mulai
              <input type="date" name="startDate" required />
            </label>
            <label className="field">
              Tanggal selesai
              <input type="date" name="endDate" required />
            </label>
            <label className="field" style={{ gridColumn: "1 / -1" }}>
              Alasan cuti
              <textarea name="reason" required minLength={10} maxLength={1000} rows={3} />
            </label>
            <label className="field">
              Status awal
              <select name="status" defaultValue="APPROVED">
                <option value="APPROVED">Langsung disetujui</option>
                <option value="PENDING">Menunggu persetujuan</option>
              </select>
            </label>
            <div className="btn-row">
              <button className="btn btn--primary" disabled={busy}>
                {busy ? "Menyimpan…" : "Simpan Cuti"}
              </button>
            </div>
          </div>
        </form>
      ) : null}
    </section>
  );
}
