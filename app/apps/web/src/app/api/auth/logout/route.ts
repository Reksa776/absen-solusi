import {
  clearSessionCookie,
  jsonResponse,
  requireApiSession,
  revokeSession,
} from "@absensi/auth";

import { appendSetCookies, handleRouteError } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  try {
    const { token } = await requireApiSession(request);
    await revokeSession(token);
    return appendSetCookies(jsonResponse({ ok: true }), [clearSessionCookie()]);
  } catch (error) {
    return handleRouteError(error);
  }
}
