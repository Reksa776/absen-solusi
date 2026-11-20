import {
  acceptInvitation,
  authenticateRequest,
  getClientIp,
  jsonResponse,
  readJsonBody,
  requireString,
} from "@absensi/auth";

import { handleRouteError } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  try {
    // Authenticated existing-user acceptance is optional; cookie mode still
    // passes through CSRF enforcement in authenticateRequest().
    const authenticated = await authenticateRequest(request);
    const body = await readJsonBody(request);
    const result = await acceptInvitation({
      token: requireString(body, "token", 512),
      authenticatedUserId: authenticated?.session.userId ?? null,
      name: typeof body.name === "string" ? body.name : undefined,
      password: typeof body.password === "string" ? body.password : undefined,
      ip: getClientIp(request),
      userAgent: request.headers.get("user-agent"),
    });
    return jsonResponse(result, 201);
  } catch (error) {
    return handleRouteError(error);
  }
}
