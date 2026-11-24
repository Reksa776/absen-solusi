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
      <div className="btn-row" style={{ marginBottom: "1rem" }}>
        <button
          type="button"
          className="btn btn--secondary"
          disabled={busy || unreadCount === 0}
          onClick={() => void act("/api/notifications/read-all", "POST")}
        >
          Tandai semua dibaca
        </button>
        <span className="badge badge--yellow">{unreadCount} belum dibaca</span>
      </div>
      {error ? <p role="alert" className="alert">{error}</p> : null}
      {notifications.length === 0 ? (
        <p className="empty card">Belum ada notifikasi.</p>
      ) : null}
      <ul className="notification-list">
        {notifications.map((item) => (
          <li
            key={item.id}
            className={`notification${item.isRead ? "" : " notification--unread"}`}
          >
            <div className="notification-head">
              <strong>{item.title}</strong>
              <span className="notification-time">
                {item.createdAt.slice(0, 16).replace("T", " ")} UTC
              </span>
            </div>
            <p>{item.body}</p>
            <div className="action-links">
              {item.linkUrl ? <a href={item.linkUrl}>Buka detail</a> : null}
              {!item.isRead ? (
                <button
                  type="button"
                  className="btn btn--ghost btn--sm"
                  disabled={busy}
                  onClick={() => void act(`/api/notifications/${item.id}/read`, "PATCH")}
                >
                  Tandai dibaca
                </button>
              ) : (
                <span className="badge badge--neutral">Dibaca</span>
              )}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
