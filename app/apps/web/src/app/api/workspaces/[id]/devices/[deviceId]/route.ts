import {
  getClientIp,
  jsonResponse,
  readJsonBody,
  requirePermission,
  requireString,
  reviewMemberDevice,
} from "@absensi/auth";

import { handleRouteError } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string; deviceId: string }> },
): Promise<Response> {
  try {
    const { ctx } = await requirePermission(request, "member.manage");
    const { id, deviceId } = await context.params;
    const body = await readJsonBody(request);
    return jsonResponse(
      await reviewMemberDevice({
        ctx,
        workspaceId: id,
        deviceId,
        action: requireString(body, "action", 16),
        ip: getClientIp(request),
        userAgent: request.headers.get("user-agent"),
      }),
    );
  } catch (error) {
    return handleRouteError(error);
  }
}
