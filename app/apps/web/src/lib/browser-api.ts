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

export async function sendJson<T = unknown>(
  url: string,
  method: "POST" | "PATCH" | "DELETE" | "PUT",
  payload?: unknown,
): Promise<T> {
  const token = await csrfToken();
  const response = await fetch(url, {
    method,
    credentials: "same-origin",
    headers: {
      ...(payload === undefined ? {} : { "content-type": "application/json" }),
      "x-csrf-token": token,
    },
    ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
  });
  const body = (await response.json().catch(() => ({}))) as {
    error?: { message?: string };
  } & T;
  if (!response.ok) {
    throw new Error(body.error?.message ?? "Permintaan gagal.");
  }
  return body;
}
