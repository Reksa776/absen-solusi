"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import type { InAppNotificationSummary } from "@absensi/auth";

const CSRF_COOKIE = "aos_csrf";

function readCookie(name: string): string {
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return match?.[1] ? decodeURIComponent(match[1]) : "";
}

async function csrfToken(): Promise<string> {
  const existing = readCookie(CSRF_COOKIE);
  if (existing) return existing;
  const response = await fetch("/api/auth/csrf", { credentials: "same-origin" });
  const body = (await response.json()) as { csrfToken?: string };
  if (!body.csrfToken) throw new Error("CSRF token tidak tersedia");
  return body.csrfToken;
}

export function NotificationInbox({
  notifications,
  unreadCount,
}: {
  notifications: InAppNotificationSummary[];
  unreadCount: number;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function act(path: string, method: "PATCH" | "POST"): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(path, {
        method,
        credentials: "same-origin",
        headers: { "x-csrf-token": await csrfToken() },
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as {
          error?: { message?: string };
        };
        throw new Error(body.error?.message ?? "Aksi notifikasi gagal");
      }
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Aksi notifikasi gagal");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section>
      <div style={{ display: "flex", gap: "0.75rem", marginBottom: "1rem" }}>
        <button
          type="button"
          disabled={busy || unreadCount === 0}
          onClick={() => void act("/api/notifications/read-all", "POST")}
          style={{ padding: "0.5rem 0.8rem" }}
        >
          Tandai semua dibaca
        </button>
      </div>
      {error ? <p style={{ color: "#b00020" }}>{error}</p> : null}
      {notifications.length === 0 ? <p>Belum ada notifikasi.</p> : null}
      <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: "0.75rem" }}>
        {notifications.map((item) => (
          <li
            key={item.id}
            style={{
              border: "1px solid #ddd",
              borderRadius: "0.5rem",
              padding: "0.9rem 1rem",
              background: item.isRead ? "#fff" : "#e0f2f1",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", gap: "1rem" }}>
              <strong>{item.title}</strong>
              <span style={{ color: "#666", fontSize: "0.8rem", whiteSpace: "nowrap" }}>
                {item.createdAt.slice(0, 16).replace("T", " ")} UTC
              </span>
            </div>
            <p style={{ margin: "0.35rem 0" }}>{item.body}</p>
            <div style={{ display: "flex", gap: "0.75rem", alignItems: "center" }}>
              {item.linkUrl ? (
                <a href={item.linkUrl} style={{ color: "#00695c" }}>
                  Buka detail
                </a>
              ) : null}
              {!item.isRead ? (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void act(`/api/notifications/${item.id}/read`, "PATCH")}
                  style={{ padding: "0.25rem 0.5rem" }}
                >
                  Tandai dibaca
                </button>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
