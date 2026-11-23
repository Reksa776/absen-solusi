import {
  getClientIp,
  jsonResponse,
  requirePermission,
  reviewMemberDevice,
} from "@absensi/auth";

import { handleRouteError } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string; deviceId: string }> },
): Promise<Response> {
  try {
    const { ctx } = await requirePermission(request, "member.manage");
    const { id, deviceId } = await context.params;
    return jsonResponse(
      await reviewMemberDevice({
        ctx,
        workspaceId: id,
        deviceId,
        action: "APPROVE",
        ip: getClientIp(request),
        userAgent: request.headers.get("user-agent"),
      }),
    );
  } catch (error) {
    return handleRouteError(error);
  }
}
