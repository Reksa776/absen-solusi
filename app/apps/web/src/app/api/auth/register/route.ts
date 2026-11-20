import {
  assertPublicCsrf,
  enforceRegisterRateLimit,
  getClientIp,
  HttpError,
  jsonResponse,
  readJsonBody,
  registerBootstrap,
  requireString,
} from "@absensi/auth";

import { handleRouteError } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  try {
    assertPublicCsrf(request);
    // Bucket khusus register, fail-closed bila backend limiter tidak tersedia.
    const limit = await enforceRegisterRateLimit({ ip: getClientIp(request) });
    if (!limit.allowed) {
      throw new HttpError(
        limit.status,
        limit.status === 429 ? "RATE_LIMITED" : "RATE_LIMITER_UNAVAILABLE",
        limit.message,
        limit.retryAfterSeconds,
      );
    }
    const body = await readJsonBody(request);
    const result = await registerBootstrap({
      email: requireString(body, "email", 255),
      password: requireString(body, "password", 128),
      name: requireString(body, "name", 120),
      workspaceName:
        typeof body.workspaceName === "string" ? body.workspaceName.slice(0, 120) : undefined,
      ip: getClientIp(request),
      userAgent: request.headers.get("user-agent"),
    });
    return jsonResponse(result, 201);
  } catch (error) {
    return handleRouteError(error);
  }
}
