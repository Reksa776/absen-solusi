"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { ROLE_KEYS, ROLE_LABELS, type RoleKey } from "@absensi/permissions";

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

type Member = {
  id: string;
  status: string;
  joinedAt: string | null;
  officeLocationId: string | null;
  user: { id: string; name: string; email: string };
  roleKeys: string[];
};

type OfficeOption = { id: string; name: string };

export function MemberAdmin({
  workspaceId,
  currentMemberId,
  members,
  offices,
  canInvite,
  canManageRoles,
  canAssignOffice,
}: {
  workspaceId: string;
  currentMemberId: string | null;
  members: Member[];
  offices: OfficeOption[];
  canInvite: boolean;
  canManageRoles: boolean;
  canAssignOffice: boolean;
}) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<RoleKey>("VIEWER");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function postJson(url: string, method: "POST" | "PATCH", payload: unknown) {
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

  async function invite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const ok = await postJson(`/api/workspaces/${workspaceId}/members`, "POST", { email, role });
    if (ok) {
      setEmail("");
      setNotice("Undangan dibuat.");
      router.refresh();
    }
  }

  async function changeRole(memberId: string, nextRole: string) {
    const ok = await postJson(
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
    const ok = await postJson(
      `/api/workspaces/${workspaceId}/members/${memberId}/office`,
      "PATCH",
      { officeLocationId: officeLocationId || null },
    );
    if (ok) {
      setNotice("Penugasan kantor diperbarui.");
      router.refresh();
    }
  }

  return (
    <section>
      {canInvite ? (
        <form
          onSubmit={invite}
          style={{
            display: "flex",
            gap: "0.5rem",
            flexWrap: "wrap",
            alignItems: "end",
            padding: "1rem",
            background: "#f5f5f5",
            marginBottom: "1.5rem",
          }}
        >
          <label style={{ display: "grid", gap: "0.25rem" }}>
            Email
            <input
              type="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              style={{ padding: "0.5rem" }}
            />
          </label>
          <label style={{ display: "grid", gap: "0.25rem" }}>
            Role
            <select
              value={role}
              onChange={(event) => setRole(event.target.value as RoleKey)}
              style={{ padding: "0.5rem" }}
            >
              {ROLE_KEYS.map((key) => (
                <option key={key} value={key}>
                  {ROLE_LABELS[key]}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" disabled={busy} style={{ padding: "0.6rem" }}>
            {busy ? "Memproses…" : "Undang member"}
          </button>
        </form>
      ) : null}

      {error ? (
        <p role="alert" style={{ color: "#b00020" }}>
          {error}
        </p>
      ) : null}
      {notice ? <p role="status">{notice}</p> : null}

      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr>
            <th style={{ textAlign: "left", borderBottom: "1px solid #ccc", padding: "0.5rem" }}>Nama</th>
            <th style={{ textAlign: "left", borderBottom: "1px solid #ccc", padding: "0.5rem" }}>Email</th>
            <th style={{ textAlign: "left", borderBottom: "1px solid #ccc", padding: "0.5rem" }}>Status</th>
            <th style={{ textAlign: "left", borderBottom: "1px solid #ccc", padding: "0.5rem" }}>Role</th>
            {canAssignOffice ? (
              <th style={{ textAlign: "left", borderBottom: "1px solid #ccc", padding: "0.5rem" }}>Kantor</th>
            ) : null}
          </tr>
        </thead>
        <tbody>
          {members.map((member) => (
            <tr key={member.id}>
              <td style={{ padding: "0.5rem" }}>{member.user.name}</td>
              <td style={{ padding: "0.5rem" }}>{member.user.email}</td>
              <td style={{ padding: "0.5rem" }}>{member.status}</td>
              <td style={{ padding: "0.5rem" }}>
                {canManageRoles && member.id !== currentMemberId && member.status === "ACTIVE" ? (
                  <select
                    defaultValue={member.roleKeys[0] ?? "VIEWER"}
                    onChange={(event) => changeRole(member.id, event.target.value)}
                    disabled={busy}
                    style={{ padding: "0.35rem" }}
                  >
                    {ROLE_KEYS.map((key) => (
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
                <td style={{ padding: "0.5rem" }}>
                  <select
                    value={member.officeLocationId ?? ""}
                    onChange={(event) => assignOffice(member.id, event.target.value)}
                    disabled={busy || member.status !== "ACTIVE"}
                    style={{ padding: "0.35rem" }}
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
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
