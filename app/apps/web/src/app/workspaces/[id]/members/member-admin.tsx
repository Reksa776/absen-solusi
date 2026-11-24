"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

const CSRF_COOKIE = "aos_csrf";
const PASSWORD_MIN_LENGTH = 12;

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

type Member = {
  id: string;
  status: string;
  joinedAt: string | null;
  officeLocationId: string | null;
  divisionId: string | null;
  positionId: string | null;
  divisionName: string | null;
  positionName: string | null;
  user: { id: string; name: string; email: string };
  roleKeys: string[];
};

type OfficeOption = { id: string; name: string };
type DivisionOption = { id: string; name: string };
type PositionOption = { id: string; name: string; divisionName: string | null };

type EmployeeForm = {
  name: string;
  status: "ACTIVE" | "INACTIVE";
  divisionId: string;
  positionId: string;
  officeLocationId: string;
};

const EMPTY_FORM: EmployeeForm = {
  name: "",
  status: "ACTIVE",
  divisionId: "",
  positionId: "",
  officeLocationId: "",
};

export function MemberAdmin({
  workspaceId,
  currentMemberId,
  members,
  offices,
  divisions,
  positions,
  canInvite,
  canAssignOffice,
  canManageOrganization,
  canResetPassword,
}: {
  workspaceId: string;
  currentMemberId: string | null;
  members: Member[];
  offices: OfficeOption[];
  divisions: DivisionOption[];
  positions: PositionOption[];
  canInvite: boolean;
  canAssignOffice: boolean;
  canManageOrganization: boolean;
  canResetPassword: boolean;
}) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState<"ACTIVE" | "INACTIVE">("ACTIVE");
  const [officeId, setOfficeId] = useState("");
  const [divisionId, setDivisionId] = useState("");
  const [positionId, setPositionId] = useState("");
  const [editing, setEditing] = useState<Member | null>(null);
  const [editForm, setEditForm] = useState<EmployeeForm>(EMPTY_FORM);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [divisionFilter, setDivisionFilter] = useState("");
  const [positionFilter, setPositionFilter] = useState("");

  const normalizedQuery = query.trim().toLowerCase();
  const visibleMembers = members.filter((member) => {
    if (divisionFilter && member.divisionId !== divisionFilter) return false;
    if (positionFilter && member.positionId !== positionFilter) return false;
    if (!normalizedQuery) return true;
    return (
      member.user.name.toLowerCase().includes(normalizedQuery) ||
      member.user.email.toLowerCase().includes(normalizedQuery)
    );
  });

  async function requestJson(url: string, method: "POST" | "PATCH", payload: unknown) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const token = await csrfToken();
      const response = await fetch(url, {
        method,
        credentials: "same-origin",
        headers: { "content-type": "application/json", "x-csrf-token": token },
        body: JSON.stringify(payload),
      });
      const body = (await response.json()) as { error?: { message?: string } };
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

  async function addEmployee(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const ok = await requestJson(`/api/workspaces/${workspaceId}/members/direct`, "POST", {
      name,
      email,
      password,
      status,
      officeId: officeId || null,
      divisionId: divisionId || null,
      positionId: positionId || null,
    });
    if (ok) {
      setName("");
      setEmail("");
      setPassword("");
      setStatus("ACTIVE");
      setOfficeId("");
      setDivisionId("");
      setPositionId("");
      setNotice(
        "Karyawan berhasil ditambahkan dengan role karyawan standar dan dapat langsung login.",
      );
      router.refresh();
    }
  }

  function startEdit(member: Member) {
    setEditing(member);
    setEditForm({
      name: member.user.name,
      status: member.status === "INACTIVE" ? "INACTIVE" : "ACTIVE",
      divisionId: member.divisionId ?? "",
      positionId: member.positionId ?? "",
      officeLocationId: member.officeLocationId ?? "",
    });
    setError(null);
    setNotice(null);
  }

  async function saveEmployee(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editing) return;
    const ok = await requestJson(
      `/api/workspaces/${workspaceId}/members/${editing.id}/employee`,
      "PATCH",
      {
        name: editForm.name,
        status: editForm.status,
        ...(canManageOrganization
          ? {
              divisionId: editForm.divisionId || null,
              positionId: editForm.positionId || null,
            }
          : {}),
        ...(canAssignOffice ? { officeLocationId: editForm.officeLocationId || null } : {}),
      },
    );
    if (ok) {
      setNotice(`Data ${editForm.name} diperbarui.`);
      setEditing(null);
      router.refresh();
    }
  }

  async function resetPassword(member: Member) {
    const nextPassword = window.prompt(
      `Password baru untuk ${member.user.email} (minimal ${PASSWORD_MIN_LENGTH} karakter):`,
    );
    if (nextPassword === null) return;
    if (nextPassword.length < PASSWORD_MIN_LENGTH) {
      setError(`Password minimal ${PASSWORD_MIN_LENGTH} karakter`);
      return;
    }
    const ok = await requestJson(
      `/api/workspaces/${workspaceId}/members/${member.id}/password`,
      "PATCH",
      { password: nextPassword },
    );
    if (ok) {
      setNotice(`Password ${member.user.email} berhasil direset. Semua sesi lama dicabut.`);
    }
  }

  return (
    <section>
      {canInvite ? (
        <form onSubmit={addEmployee} aria-label="Tambah Karyawan Langsung" className="form-card">
          <div className="card-head" style={{ padding: "0 0 0.85rem", borderBottom: "none" }}>
            <div>
              <h2 className="section-title">Tambah Karyawan Langsung</h2>
              <p className="section-note">
                Akun aktif tanpa undangan email. Role otomatis karyawan standar.
              </p>
            </div>
          </div>
          <div className="form-grid">
            <label className="field">
              Nama
              <input required value={name} onChange={(event) => setName(event.target.value)} />
            </label>
            <label className="field">
              Email
              <input
                type="email"
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            </label>
            <label className="field">
              Password awal
              <input
                type="password"
                autoComplete="new-password"
                required
                minLength={PASSWORD_MIN_LENGTH}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </label>
            <label className="field">
              Status
              <select
                value={status}
                onChange={(event) => setStatus(event.target.value as "ACTIVE" | "INACTIVE")}
              >
                <option value="ACTIVE">Aktif</option>
                <option value="INACTIVE">Nonaktif</option>
              </select>
            </label>
            {canManageOrganization ? (
              <label className="field">
                Divisi
                <select value={divisionId} onChange={(event) => setDivisionId(event.target.value)}>
                  <option value="">Tanpa divisi</option>
                  {divisions.map((division) => (
                    <option key={division.id} value={division.id}>
                      {division.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            {canManageOrganization ? (
              <label className="field">
                Jabatan
                <select value={positionId} onChange={(event) => setPositionId(event.target.value)}>
                  <option value="">Tanpa jabatan</option>
                  {positions.map((position) => (
                    <option key={position.id} value={position.id}>
                      {position.divisionName
                        ? `${position.name} · ${position.divisionName}`
                        : position.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            {canAssignOffice ? (
              <label className="field">
                Lokasi kehadiran
                <select value={officeId} onChange={(event) => setOfficeId(event.target.value)}>
                  <option value="">Semua kantor aktif</option>
                  {offices.map((office) => (
                    <option key={office.id} value={office.id}>
                      {office.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            <div>
              <button type="submit" className="btn btn--primary" disabled={busy}>
                {busy ? "Memproses…" : "Tambah Karyawan"}
              </button>
            </div>
          </div>
        </form>
      ) : null}

      {editing ? (
        <form onSubmit={saveEmployee} className="form-card" aria-label="Edit Data Karyawan">
          <div className="card-head" style={{ padding: "0 0 0.85rem", borderBottom: "none" }}>
            <div>
              <h2 className="section-title">Edit Data Karyawan</h2>
              <p className="section-note">{editing.user.email}</p>
            </div>
          </div>
          <div className="form-grid">
            <label className="field">
              Nama
              <input
                required
                value={editForm.name}
                onChange={(event) =>
                  setEditForm((current) => ({ ...current, name: event.target.value }))
                }
              />
            </label>
            <label className="field">
              Status
              <select
                value={editForm.status}
                onChange={(event) =>
                  setEditForm((current) => ({
                    ...current,
                    status: event.target.value as "ACTIVE" | "INACTIVE",
                  }))
                }
              >
                <option value="ACTIVE">Aktif</option>
                <option value="INACTIVE">Nonaktif</option>
              </select>
            </label>
            {canManageOrganization ? (
              <label className="field">
                Divisi
                <select
                  value={editForm.divisionId}
                  onChange={(event) =>
                    setEditForm((current) => ({
                      ...current,
                      divisionId: event.target.value,
                      positionId: "",
                    }))
                  }
                >
                  <option value="">Tanpa divisi</option>
                  {divisions.map((division) => (
                    <option key={division.id} value={division.id}>
                      {division.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            {canManageOrganization ? (
              <label className="field">
                Jabatan
                <select
                  value={editForm.positionId}
                  onChange={(event) =>
                    setEditForm((current) => ({ ...current, positionId: event.target.value }))
                  }
                >
                  <option value="">Tanpa jabatan</option>
                  {positions.map((position) => (
                    <option key={position.id} value={position.id}>
                      {position.divisionName
                        ? `${position.name} · ${position.divisionName}`
                        : position.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            {canAssignOffice ? (
              <label className="field">
                Lokasi kehadiran
                <select
                  value={editForm.officeLocationId}
                  onChange={(event) =>
                    setEditForm((current) => ({
                      ...current,
                      officeLocationId: event.target.value,
                    }))
                  }
                >
                  <option value="">Semua kantor aktif</option>
                  {offices.map((office) => (
                    <option key={office.id} value={office.id}>
                      {office.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            <div className="btn-row">
              <button type="submit" className="btn btn--primary" disabled={busy}>
                {busy ? "Menyimpan…" : "Simpan data"}
              </button>
              <button
                type="button"
                className="btn btn--secondary"
                onClick={() => setEditing(null)}
                disabled={busy}
              >
                Batal
              </button>
            </div>
          </div>
        </form>
      ) : null}

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

      <div className="toolbar" aria-label="Filter karyawan">
        <label className="field" style={{ minWidth: "12rem" }}>
          Cari karyawan
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Nama atau email"
          />
        </label>
        {canManageOrganization ? (
          <label className="field">
            Filter divisi
            <select
              value={divisionFilter}
              onChange={(event) => setDivisionFilter(event.target.value)}
            >
              <option value="">Semua divisi</option>
              {divisions.map((division) => (
                <option key={division.id} value={division.id}>
                  {division.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        {canManageOrganization ? (
          <label className="field">
            Filter jabatan
            <select
              value={positionFilter}
              onChange={(event) => setPositionFilter(event.target.value)}
            >
              <option value="">Semua jabatan</option>
              {positions.map((position) => (
                <option key={position.id} value={position.id}>
                  {position.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </div>

      <div className="table-wrap">
        <div className="table-head">
          <div>
            <h2 className="section-title">Daftar karyawan</h2>
            <p className="section-note">
              <span className="num">{visibleMembers.length}</span> dari{" "}
              <span className="num">{members.length}</span> akun pada halaman ini
            </p>
          </div>
        </div>
        <div className="table-scroll">
          <table className="data">
            <thead>
              <tr>
                <th>Nama</th>
                <th>Email</th>
                <th>Status</th>
                {canManageOrganization ? <th>Divisi</th> : null}
                {canManageOrganization ? <th>Jabatan</th> : null}
                {canAssignOffice ? <th>Lokasi</th> : null}
                {canResetPassword || canManageOrganization || canAssignOffice ? (
                  <th>Aksi</th>
                ) : null}
              </tr>
            </thead>
            <tbody>
              {visibleMembers.length === 0 ? (
                <tr>
                  <td colSpan={7} className="empty">
                    Tidak ada karyawan yang cocok dengan filter.
                  </td>
                </tr>
              ) : null}
              {visibleMembers.map((member) => (
                <tr key={member.id}>
                  <td>
                    <span className="cell-title">{member.user.name}</span>
                  </td>
                  <td className="muted">{member.user.email}</td>
                  <td>
                    <span
                      className={
                        member.status === "ACTIVE" ? "badge badge--green" : "badge badge--neutral"
                      }
                    >
                      {member.status === "ACTIVE" ? "Aktif" : "Nonaktif"}
                    </span>
                  </td>
                  {canManageOrganization ? <td>{member.divisionName ?? "—"}</td> : null}
                  {canManageOrganization ? <td>{member.positionName ?? "—"}</td> : null}
                  {canAssignOffice ? (
                    <td>
                      {offices.find((office) => office.id === member.officeLocationId)?.name ??
                        "Semua kantor"}
                    </td>
                  ) : null}
                  {canResetPassword || canManageOrganization || canAssignOffice ? (
                    <td>
                      <div className="btn-row">
                        {member.id !== currentMemberId &&
                        (canManageOrganization || canAssignOffice) ? (
                          <button
                            type="button"
                            className="btn btn--secondary btn--sm"
                            onClick={() => startEdit(member)}
                            disabled={busy}
                          >
                            Edit
                          </button>
                        ) : null}
                        {canResetPassword &&
                        member.status === "ACTIVE" &&
                        member.id !== currentMemberId ? (
                          <button
                            type="button"
                            className="btn btn--secondary btn--sm"
                            onClick={() => resetPassword(member)}
                            disabled={busy}
                          >
                            Reset Password
                          </button>
                        ) : null}
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
