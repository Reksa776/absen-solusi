import {
  getClientIp,
  jsonResponse,
  readJsonBody,
  requireApiSession,
  requireString,
  switchActiveWorkspace,
} from "@absensi/auth";

import { handleRouteError } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  try {
    const { session } = await requireApiSession(request);
    const body = await readJsonBody(request);
    const result = await switchActiveWorkspace({
      sessionId: session.id,
      userId: session.userId,
      currentTenantId: session.activeTenantId,
      workspaceId: requireString(body, "workspaceId", 36),
      ip: getClientIp(request),
      userAgent: request.headers.get("user-agent"),
    });
    return jsonResponse(result);
  } catch (error) {
    return handleRouteError(error);
  }
}
