import {
  getClientIp,
  jsonResponse,
  publishBroadcast,
  requirePermission,
} from "@absensi/auth";

import { handleRouteError } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string; broadcastId: string }> },
): Promise<Response> {
  try {
    const { ctx } = await requirePermission(request, "member.manage");
    const { id, broadcastId } = await context.params;
    return jsonResponse(
      await publishBroadcast({
        ctx,
        workspaceId: id,
        broadcastId,
        ip: getClientIp(request),
        userAgent: request.headers.get("user-agent"),
      }),
    );
  } catch (error) {
    return handleRouteError(error);
  }
}
