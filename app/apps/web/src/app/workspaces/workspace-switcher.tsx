"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

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

export function WorkspaceSwitcher({
  workspaces,
  activeTenantId,
}: {
  workspaces: Array<{ id: string; name: string }>;
  activeTenantId: string | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onChange(event: React.ChangeEvent<HTMLSelectElement>) {
    const workspaceId = event.target.value;
    if (!workspaceId) return;
    setBusy(true);
    setError(null);
    try {
      const token = await csrfToken();
      const response = await fetch("/api/auth/active-workspace", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json", "x-csrf-token": token },
        body: JSON.stringify({ workspaceId }),
      });
      const body = (await response.json()) as { error?: { message?: string } };
      if (!response.ok) {
        setError(body.error?.message ?? "Gagal berpindah workspace");
        return;
      }
      router.refresh();
    } catch {
      setError("Tidak dapat menghubungi server");
    } finally {
      setBusy(false);
    }
  }

  if (workspaces.length === 0) return <p className="muted">Belum ada workspace.</p>;

  return (
    <div style={{ display: "grid", gap: "0.35rem", marginBottom: "1rem" }}>
      <label htmlFor="workspace-switcher" className="field">
        Workspace aktif
        <select
          id="workspace-switcher"
          value={activeTenantId ?? ""}
          onChange={onChange}
          disabled={busy}
        >
          {workspaces.map((workspace) => (
            <option key={workspace.id} value={workspace.id}>
              {workspace.name}
            </option>
          ))}
        </select>
      </label>
      {error ? (
        <p role="alert" className="alert" style={{ margin: 0 }}>
          {error}
        </p>
      ) : null}
    </div>
  );
}
