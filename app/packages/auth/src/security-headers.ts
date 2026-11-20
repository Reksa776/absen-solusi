export const HSTS_HEADER = "max-age=31536000; includeSubDomains";

/**
 * Header keamanan untuk semua respons. HSTS hanya dikirim di production
 * (dev berjalan di http://localhost dan tidak boleh di-HSTS oleh browser).
 */
export function securityHeaders(
  isProduction: boolean,
  nonce?: string,
): Record<string, string> {
  const scriptSrc = nonce
    ? `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`
    : "script-src 'self'";
  const headers: Record<string, string> = {
    "Content-Security-Policy": [
      "default-src 'self'",
      scriptSrc,
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data:",
      "font-src 'self'",
      "connect-src 'self'",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'",
    ].join("; "),
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=()",
    "Cross-Origin-Opener-Policy": "same-origin",
  };
  if (isProduction) headers["Strict-Transport-Security"] = HSTS_HEADER;
  return headers;
}

/** Route API tidak boleh di-cache oleh browser/proxy. */
export function cacheControlFor(pathname: string): string | null {
  return pathname === "/api" || pathname.startsWith("/api/") ? "no-store" : null;
}
