"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

const CSRF_COOKIE = "aos_csrf";

type Division = {
  id: string;
  name: string;
  code: string | null;
  description: string | null;
  isActive: boolean;
  memberCount: number;
  positionCount: number;
};

type Position = {
  id: string;
  divisionId: string | null;
  divisionName: string | null;
  name: string;
  code: string | null;
  description: string | null;
  isActive: boolean;
  memberCount: number;
};

type DivisionForm = {
  name: string;
  code: string;
  description: string;
  isActive: boolean;
};

type PositionForm = {
  name: string;
  code: string;
  description: string;
  divisionId: string;
  isActive: boolean;
};

const EMPTY_DIVISION: DivisionForm = {
  name: "",
  code: "",
  description: "",
  isActive: true,
};

const EMPTY_POSITION: PositionForm = {
  name: "",
  code: "",
  description: "",
  divisionId: "",
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

export function OrganizationManager({
  workspaceId,
  divisions,
  positions,
  canManage,
}: {
  workspaceId: string;
  divisions: Division[];
  positions: Position[];
  canManage: boolean;
}) {
  const router = useRouter();
  const [editingDivisionId, setEditingDivisionId] = useState<string | null>(null);
  const [divisionForm, setDivisionForm] = useState<DivisionForm>(EMPTY_DIVISION);
  const [editingPositionId, setEditingPositionId] = useState<string | null>(null);
  const [positionForm, setPositionForm] = useState<PositionForm>(EMPTY_POSITION);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function send(
    url: string,
    method: "POST" | "PATCH" | "DELETE",
    payload?: unknown,
  ): Promise<boolean> {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const token = await csrfToken();
      const init: RequestInit = {
        method,
        credentials: "same-origin",
        headers: payload
          ? { "content-type": "application/json", "x-csrf-token": token }
          : { "x-csrf-token": token },
        ...(payload ? { body: JSON.stringify(payload) } : {}),
      };
      const response = await fetch(url, init);
      const body = (await response.json().catch(() => ({}))) as {
        error?: { message?: string };
      };
      if (!response.ok) {
        setError(body.error?.message ?? "Permintaan gagal.");
        return false;
      }
      return true;
    } catch {
      setError("Tidak dapat menghubungi server.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  function resetDivision() {
    setEditingDivisionId(null);
    setDivisionForm(EMPTY_DIVISION);
  }

  function editDivision(division: Division) {
    setEditingDivisionId(division.id);
    setDivisionForm({
      name: division.name,
      code: division.code ?? "",
      description: division.description ?? "",
      isActive: division.isActive,
    });
    setError(null);
    setNotice(null);
  }

  async function submitDivision(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const ok = await send(
      editingDivisionId
        ? `/api/workspaces/${workspaceId}/divisions/${editingDivisionId}`
        : `/api/workspaces/${workspaceId}/divisions`,
      editingDivisionId ? "PATCH" : "POST",
      divisionForm,
    );
    if (!ok) return;
    setNotice(editingDivisionId ? "Divisi diperbarui." : "Divisi ditambahkan.");
    resetDivision();
    router.refresh();
  }

  async function removeDivision(division: Division) {
    const confirmed = window.confirm(
      `Hapus divisi "${division.name}"? Tindakan ini tidak dapat dibatalkan.`,
    );
    if (!confirmed) return;
    const ok = await send(
      `/api/workspaces/${workspaceId}/divisions/${division.id}`,
      "DELETE",
    );
    if (!ok) return;
    if (editingDivisionId === division.id) resetDivision();
    setNotice("Divisi dihapus.");
    router.refresh();
  }

  function resetPosition() {
    setEditingPositionId(null);
    setPositionForm(EMPTY_POSITION);
  }

  function editPosition(position: Position) {
    setEditingPositionId(position.id);
    setPositionForm({
      name: position.name,
      code: position.code ?? "",
      description: position.description ?? "",
      divisionId: position.divisionId ?? "",
      isActive: position.isActive,
    });
    setError(null);
    setNotice(null);
  }

  async function submitPosition(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const ok = await send(
      editingPositionId
        ? `/api/workspaces/${workspaceId}/positions/${editingPositionId}`
        : `/api/workspaces/${workspaceId}/positions`,
      editingPositionId ? "PATCH" : "POST",
      { ...positionForm, divisionId: positionForm.divisionId || null },
    );
    if (!ok) return;
    setNotice(editingPositionId ? "Jabatan diperbarui." : "Jabatan ditambahkan.");
    resetPosition();
    router.refresh();
  }

  async function removePosition(position: Position) {
    const confirmed = window.confirm(
      `Hapus jabatan "${position.name}"? Tindakan ini tidak dapat dibatalkan.`,
    );
    if (!confirmed) return;
    const ok = await send(
      `/api/workspaces/${workspaceId}/positions/${position.id}`,
      "DELETE",
    );
    if (!ok) return;
    if (editingPositionId === position.id) resetPosition();
    setNotice("Jabatan dihapus.");
    router.refresh();
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

      {canManage ? (
        <form onSubmit={submitDivision} className="form-card" aria-label="Form divisi">
          <div className="table-head" style={{ padding: "0 0 0.85rem", borderBottom: "none" }}>
            <div>
              <h2 className="section-title">
                {editingDivisionId ? "Edit divisi" : "Tambah divisi"}
              </h2>
              <p className="section-note">
                Divisi menjadi pengelompokan utama karyawan dan laporan.
              </p>
            </div>
          </div>
          <div className="form-grid">
            <label className="field">
              Nama divisi
              <input
                required
                maxLength={120}
                value={divisionForm.name}
                onChange={(event) =>
                  setDivisionForm((current) => ({ ...current, name: event.target.value }))
                }
              />
            </label>
            <label className="field">
              Kode
              <input
                maxLength={30}
                placeholder="OPS"
                className="mono"
                value={divisionForm.code}
                onChange={(event) =>
                  setDivisionForm((current) => ({ ...current, code: event.target.value }))
                }
              />
            </label>
            <label className="field field--wide">
              Deskripsi
              <input
                maxLength={255}
                value={divisionForm.description}
                onChange={(event) =>
                  setDivisionForm((current) => ({
                    ...current,
                    description: event.target.value,
                  }))
                }
              />
            </label>
            <label className="field--check">
              <input
                type="checkbox"
                checked={divisionForm.isActive}
                onChange={(event) =>
                  setDivisionForm((current) => ({
                    ...current,
                    isActive: event.target.checked,
                  }))
                }
              />
              Aktif
            </label>
            <div className="btn-row">
              <button type="submit" className="btn btn--primary" disabled={busy}>
                {busy ? "Memproses…" : editingDivisionId ? "Simpan perubahan" : "Tambah divisi"}
              </button>
              {editingDivisionId ? (
                <button
                  type="button"
                  className="btn btn--secondary"
                  onClick={resetDivision}
                  disabled={busy}
                >
                  Batal
                </button>
              ) : null}
            </div>
          </div>
        </form>
      ) : null}

      <div className="table-wrap">
        <div className="table-head">
          <div>
            <h2 className="section-title">Daftar divisi</h2>
            <p className="section-note">
              <span className="num">{divisions.length}</span> divisi terdaftar
            </p>
          </div>
        </div>
        <div className="table-scroll">
          <table className="data">
            <thead>
              <tr>
                {["Nama", "Kode", "Deskripsi", "Jabatan", "Karyawan", "Status"].map((label) => (
                  <th key={label}>{label}</th>
                ))}
                {canManage ? <th>Aksi</th> : null}
              </tr>
            </thead>
            <tbody>
              {divisions.length === 0 ? (
                <tr>
                  <td colSpan={canManage ? 7 : 6} className="empty">
                    Belum ada divisi. Tambahkan divisi pertama untuk mulai menata struktur.
                  </td>
                </tr>
              ) : null}
              {divisions.map((division) => (
                <tr key={division.id}>
                  <td>
                    <span className="cell-title">{division.name}</span>
                  </td>
                  <td className="mono">{division.code ?? "—"}</td>
                  <td className="muted">{division.description ?? "—"}</td>
                  <td className="num">{division.positionCount}</td>
                  <td className="num">{division.memberCount}</td>
                  <td>
                    <span
                      className={
                        division.isActive ? "badge badge--green" : "badge badge--neutral"
                      }
                    >
                      {division.isActive ? "Aktif" : "Nonaktif"}
                    </span>
                  </td>
                  {canManage ? (
                    <td className="nowrap">
                      <div className="btn-row">
                        <button
                          type="button"
                          className="btn btn--secondary btn--sm"
                          onClick={() => editDivision(division)}
                          disabled={busy}
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          className="btn btn--danger btn--sm"
                          onClick={() => removeDivision(division)}
                          disabled={busy}
                        >
                          Hapus
                        </button>
                      </div>
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {canManage ? (
        <form
          onSubmit={submitPosition}
          className="form-card"
          style={{ marginTop: "1.25rem" }}
          aria-label="Form jabatan"
        >
          <div className="table-head" style={{ padding: "0 0 0.85rem", borderBottom: "none" }}>
            <div>
              <h2 className="section-title">
                {editingPositionId ? "Edit jabatan" : "Tambah jabatan"}
              </h2>
              <p className="section-note">
                Jabatan boleh berdiri sendiri atau terikat pada satu divisi.
              </p>
            </div>
          </div>
          <div className="form-grid">
            <label className="field">
              Nama jabatan
              <input
                required
                maxLength={120}
                value={positionForm.name}
                onChange={(event) =>
                  setPositionForm((current) => ({ ...current, name: event.target.value }))
                }
              />
            </label>
            <label className="field">
              Kode
              <input
                maxLength={30}
                placeholder="SPV-OPS"
                className="mono"
                value={positionForm.code}
                onChange={(event) =>
                  setPositionForm((current) => ({ ...current, code: event.target.value }))
                }
              />
            </label>
            <label className="field">
              Divisi
              <select
                value={positionForm.divisionId}
                onChange={(event) =>
                  setPositionForm((current) => ({
                    ...current,
                    divisionId: event.target.value,
                  }))
                }
              >
                <option value="">Tanpa divisi</option>
                {divisions
                  .filter((division) => division.isActive || division.id === positionForm.divisionId)
                  .map((division) => (
                    <option key={division.id} value={division.id}>
                      {division.name}
                    </option>
                  ))}
              </select>
            </label>
            <label className="field field--wide">
              Deskripsi
              <input
                maxLength={255}
                value={positionForm.description}
                onChange={(event) =>
                  setPositionForm((current) => ({
                    ...current,
                    description: event.target.value,
                  }))
                }
              />
            </label>
            <label className="field--check">
              <input
                type="checkbox"
                checked={positionForm.isActive}
                onChange={(event) =>
                  setPositionForm((current) => ({
                    ...current,
                    isActive: event.target.checked,
                  }))
                }
              />
              Aktif
            </label>
            <div className="btn-row">
              <button type="submit" className="btn btn--primary" disabled={busy}>
                {busy ? "Memproses…" : editingPositionId ? "Simpan perubahan" : "Tambah jabatan"}
              </button>
              {editingPositionId ? (
                <button
                  type="button"
                  className="btn btn--secondary"
                  onClick={resetPosition}
                  disabled={busy}
                >
                  Batal
                </button>
              ) : null}
            </div>
          </div>
        </form>
      ) : null}

      <div className="table-wrap">
        <div className="table-head">
          <div>
            <h2 className="section-title">Daftar jabatan</h2>
            <p className="section-note">
              <span className="num">{positions.length}</span> jabatan terdaftar
            </p>
          </div>
        </div>
        <div className="table-scroll">
          <table className="data">
            <thead>
              <tr>
                {["Nama", "Kode", "Divisi", "Karyawan", "Status"].map((label) => (
                  <th key={label}>{label}</th>
                ))}
                {canManage ? <th>Aksi</th> : null}
              </tr>
            </thead>
            <tbody>
              {positions.length === 0 ? (
                <tr>
                  <td colSpan={canManage ? 6 : 5} className="empty">
                    Belum ada jabatan. Tambahkan jabatan agar penempatan karyawan lebih jelas.
                  </td>
                </tr>
              ) : null}
              {positions.map((position) => (
                <tr key={position.id}>
                  <td>
                    <span className="cell-title">{position.name}</span>
                  </td>
                  <td className="mono">{position.code ?? "—"}</td>
                  <td className={position.divisionName ? "" : "muted"}>
                    {position.divisionName ?? "Tanpa divisi"}
                  </td>
                  <td className="num">{position.memberCount}</td>
                  <td>
                    <span
                      className={
                        position.isActive ? "badge badge--green" : "badge badge--neutral"
                      }
                    >
                      {position.isActive ? "Aktif" : "Nonaktif"}
                    </span>
                  </td>
                  {canManage ? (
                    <td className="nowrap">
                      <div className="btn-row">
                        <button
                          type="button"
                          className="btn btn--secondary btn--sm"
                          onClick={() => editPosition(position)}
                          disabled={busy}
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          className="btn btn--danger btn--sm"
                          onClick={() => removePosition(position)}
                          disabled={busy}
                        >
                          Hapus
                        </button>
                      </div>
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
