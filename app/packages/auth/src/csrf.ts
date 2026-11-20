import { randomBytes, timingSafeEqual } from "node:crypto";

export const CSRF_COOKIE = "aos_csrf";
export const CSRF_HEADER = "x-csrf-token";

export function createCsrfToken(): string {
  return randomBytes(32).toString("base64url");
}

/** Perbandingan constant-time; panjang berbeda langsung ditolak. */
export function csrfTokenMatches(cookieValue: string | null | undefined, headerValue: string | null | undefined): boolean {
  if (!cookieValue || !headerValue) return false;
  const a = Buffer.from(cookieValue);
  const b = Buffer.from(headerValue);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
