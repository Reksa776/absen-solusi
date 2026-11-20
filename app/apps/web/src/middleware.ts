import { cacheControlFor, securityHeaders } from "@absensi/auth/security-headers";
import { NextResponse, type NextRequest } from "next/server";

export function middleware(request: NextRequest): NextResponse {
  // Next.js meneruskan nonce ini ke script bootstrap-nya melalui request header.
  const nonce = crypto.randomUUID();
  const headers = securityHeaders(process.env.NODE_ENV === "production", nonce);

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", headers["Content-Security-Policy"] ?? "");

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  for (const [name, value] of Object.entries(headers)) {
    response.headers.set(name, value);
  }
  const cacheControl = cacheControlFor(request.nextUrl.pathname);
  if (cacheControl) response.headers.set("cache-control", cacheControl);
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
