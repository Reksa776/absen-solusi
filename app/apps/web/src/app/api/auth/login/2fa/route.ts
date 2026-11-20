import {
  assertPublicCsrf,
  completeTwoFactorLogin,
  createCsrfToken,
  csrfCookie,
  getClientIp,
  jsonResponse,
  readJsonBody,
  requireString,
  sessionCookie,
} from "@absensi/auth";

import { appendSetCookies, handleRouteError } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  try {
    assertPublicCsrf(request, { allowBearerMode: true });
    const body = await readJsonBody(request);
    const bearerMode =
      request.headers.get("x-auth-mode")?.toLowerCase() === "bearer" ||
      Boolean(request.headers.get("authorization"));
    const result = await completeTwoFactorLogin({
      challengeToken: requireString(body, "challengeToken", 2048),
      code: requireString(body, "code", 32),
      ip: getClientIp(request),
      userAgent: request.headers.get("user-agent"),
    });
    const csrfToken = createCsrfToken();
    const response = jsonResponse({
      token: bearerMode ? result.token : undefined,
      user: result.user,
      activeTenantId: result.activeTenantId,
      workspaces: result.workspaces,
      csrfToken,
    });
    const cookies = [csrfCookie(csrfToken)];
    if (!bearerMode) cookies.unshift(sessionCookie(result.token));
    return appendSetCookies(response, cookies);
  } catch (error) {
    return handleRouteError(error);
  }
}
