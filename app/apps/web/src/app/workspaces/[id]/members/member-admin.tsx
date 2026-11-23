"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { ROLE_KEYS, ROLE_LABELS, type RoleKey } from "@absensi/permissions";

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
type ShiftOption = { id: string; name: string };
type DivisionOption = { id: string; name: string };
type PositionOption = { id: string; name: string; divisionName: string | null };

export function MemberAdmin({
  workspaceId,
  currentMemberId,
  members,
  offices,
  shifts,
  divisions,
  positions,
  canInvite,
  canManageRoles,
  canAssignOffice,
  canManageOrganization,
  canResetPassword,
}: {
  workspaceId: string;
  currentMemberId: string | null;
  members: Member[];
  offices: OfficeOption[];
  shifts: ShiftOption[];
  divisions: DivisionOption[];
  positions: PositionOption[];
  canInvite: boolean;
  canManageRoles: boolean;
  canAssignOffice: boolean;
  canManageOrganization: boolean;
  canResetPassword: boolean;
}) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<RoleKey>("EMPLOYEE");
  const [officeId, setOfficeId] = useState("");
  const [shiftId, setShiftId] = useState("");
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
    const ok = await requestJson(
      `/api/workspaces/${workspaceId}/members/direct`,
      "POST",
      {
        name,
        email,
        password,
        role,
        officeId: officeId || null,
        shiftId: shiftId || null,
      },
    );
    if (ok) {
      setName("");
      setEmail("");
      setPassword("");
      setRole("EMPLOYEE");
      setOfficeId("");
      setShiftId("");
      setNotice("Karyawan berhasil ditambahkan dan dapat langsung login di aplikasi mobile.");
      router.refresh();
    }
  }

  async function changeRole(memberId: string, nextRole: string) {
    const ok = await requestJson(
      `/api/workspaces/${workspaceId}/members/${memberId}/role`,
      "PATCH",
      { role: nextRole },
    );
    if (ok) {
      setNotice("Role diperbarui.");
      router.refresh();
    }
  }

  async function assignOffice(memberId: string, officeLocationId: string) {
    const ok = await requestJson(
      `/api/workspaces/${workspaceId}/members/${memberId}/office`,
      "PATCH",
      { officeLocationId: officeLocationId || null },
    );
    if (ok) {
      setNotice("Penugasan kantor diperbarui.");
      router.refresh();
    }
  }

  async function assignOrganization(
    memberId: string,
    divisionId: string,
    positionId: string,
  ) {
    const ok = await requestJson(
      `/api/workspaces/${workspaceId}/members/${memberId}/organization`,
      "PATCH",
      { divisionId: divisionId || null, positionId: positionId || null },
    );
    if (ok) {
      setNotice("Divisi & jabatan diperbarui.");
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

  const assignableRoles = ROLE_KEYS.filter((key) => key !== "WORKSPACE_OWNER");

  return (
    <section>
      {canInvite ? (
        <form onSubmit={addEmployee} aria-label="Tambah Karyawan Langsung" className="form-card">
          <div className="card-head" style={{ padding: "0 0 0.85rem", borderBottom: "none" }}>
            <div>
              <h2 className="section-title">Tambah Karyawan Langsung</h2>
              <p className="section-note">
                Akun langsung aktif tanpa undangan email.
              </p>
            </div>
          </div>
          <div className="form-grid">
            <label className="field">
              Nama
              <input
                required
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
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
              Role
              <select value={role} onChange={(event) => setRole(event.target.value as RoleKey)}>
                {assignableRoles.map((key) => (
                  <option key={key} value={key}>
                    {ROLE_LABELS[key]}
                  </option>
                ))}
              </select>
            </label>
            {canAssignOffice ? (
              <label className="field">
                Kantor
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
            {canAssignOffice ? (
              <label className="field">
                Shift
                <select value={shiftId} onChange={(event) => setShiftId(event.target.value)}>
                  <option value="">Tanpa shift default</option>
                  {shifts.map((shift) => (
                    <option key={shift.id} value={shift.id}>
                      {shift.name}
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
                <th>Role</th>
                {canAssignOffice ? <th>Kantor</th> : null}
                {canResetPassword ? <th>Aksi</th> : null}
              </tr>
            </thead>
            <tbody>
              {visibleMembers.length === 0 ? (
                <tr>
                  <td colSpan={8} className="empty">
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
                      {member.status === "ACTIVE" ? "Aktif" : member.status}
                    </span>
                  </td>
                  {canManageOrganization ? (
                    <td>
                      <select
                        value={member.divisionId ?? ""}
                        onChange={(event) =>
                          assignOrganization(member.id, event.target.value, "")
                        }
                        disabled={busy || member.status !== "ACTIVE"}
                        className="select-inline"
                        aria-label={`Divisi ${member.user.name}`}
                      >
                        <option value="">Tanpa divisi</option>
                        {divisions.map((division) => (
                          <option key={division.id} value={division.id}>
                            {division.name}
                          </option>
                        ))}
                      </select>
                    </td>
                  ) : null}
                  {canManageOrganization ? (
                    <td>
                      <select
                        value={member.positionId ?? ""}
                        onChange={(event) =>
                          assignOrganization(
                            member.id,
                            member.divisionId ?? "",
                            event.target.value,
                          )
                        }
                        disabled={busy || member.status !== "ACTIVE"}
                        className="select-inline"
                        aria-label={`Jabatan ${member.user.name}`}
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
                    </td>
                  ) : null}
                  <td>
                    {canManageRoles && member.id !== currentMemberId && member.status === "ACTIVE" ? (
                      <select
                        defaultValue={member.roleKeys[0] ?? "EMPLOYEE"}
                        onChange={(event) => changeRole(member.id, event.target.value)}
                        disabled={busy}
                        className="select-inline"
                      >
                        {assignableRoles.map((key) => (
                          <option key={key} value={key}>
                            {ROLE_LABELS[key]}
                          </option>
                        ))}
                      </select>
                    ) : (
                      member.roleKeys.join(", ") || "—"
                    )}
                  </td>
                  {canAssignOffice ? (
                    <td>
                      <select
                        value={member.officeLocationId ?? ""}
                        onChange={(event) => assignOffice(member.id, event.target.value)}
                        disabled={busy || member.status !== "ACTIVE"}
                        className="select-inline"
                      >
                        <option value="">Semua kantor aktif</option>
                        {offices.map((office) => (
                          <option key={office.id} value={office.id}>
                            {office.name}
                          </option>
                        ))}
                      </select>
                    </td>
                  ) : null}
                  {canResetPassword ? (
                    <td>
                      {member.status === "ACTIVE" && member.id !== currentMemberId ? (
                        <button
                          type="button"
                          className="btn btn--secondary btn--sm"
                          onClick={() => resetPassword(member)}
                          disabled={busy}
                        >
                          Reset Password
                        </button>
                      ) : (
                        <span className="muted">—</span>
                      )}
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
