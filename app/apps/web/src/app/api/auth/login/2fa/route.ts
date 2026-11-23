import {
  assertPublicCsrf,
  completeTwoFactorLogin,
  createCsrfToken,
  csrfCookie,
  getClientIp,
  jsonResponse,
  normalizeDeviceIdentity,
  readJsonBody,
  registerLoginDevice,
  requireString,
  revokeSession,
  sessionCookie,
} from "@absensi/auth";

import { appendSetCookies, handleRouteError } from "@/lib/api";
import {
  isEmployeeOnlyActiveWorkspace,
  WEB_EMPLOYEE_DENIED_MESSAGE,
} from "@/lib/web-access";

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
    if (
      !bearerMode &&
      isEmployeeOnlyActiveWorkspace(result.workspaces, result.activeTenantId)
    ) {
      await revokeSession(result.token);
      return jsonResponse(
        { error: { code: "WEB_EMPLOYEE_FORBIDDEN", message: WEB_EMPLOYEE_DENIED_MESSAGE } },
        403,
      );
    }
    const deviceIdentity = bearerMode
      ? normalizeDeviceIdentity({
          deviceId: request.headers.get("x-device-id"),
          deviceName: request.headers.get("x-device-name"),
          platform: request.headers.get("x-device-platform"),
        })
      : null;
    const activeMember = result.workspaces.find(
      (workspace) => workspace.id === result.activeTenantId,
    );
    const device =
      deviceIdentity && activeMember && result.activeTenantId
        ? await registerLoginDevice({
            tenantId: result.activeTenantId,
            userId: result.user.id,
            memberId: activeMember.memberId,
            identity: deviceIdentity,
            ip: getClientIp(request),
            userAgent: request.headers.get("user-agent"),
          })
        : null;

    const csrfToken = createCsrfToken();
    const response = jsonResponse({
      token: bearerMode ? result.token : undefined,
      user: result.user,
      activeTenantId: result.activeTenantId,
      workspaces: result.workspaces,
      device,
      redirectTo: bearerMode
        ? null
        : result.activeTenantId
          ? `/workspaces/${result.activeTenantId}/dashboard`
          : "/workspaces",
      csrfToken,
    });
    const cookies = [csrfCookie(csrfToken)];
    if (!bearerMode) cookies.unshift(sessionCookie(result.token));
    return appendSetCookies(response, cookies);
  } catch (error) {
    return handleRouteError(error);
  }
}
