import { createCsrfToken, csrfCookie, jsonResponse } from "@absensi/auth";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const token = createCsrfToken();
  const response = jsonResponse({ csrfToken: token });
  response.headers.append("set-cookie", csrfCookie(token));
  return response;
}
