import {
  getClientIp,
  jsonResponse,
  requirePermission,
  resetMemberDevices,
} from "@absensi/auth";

import { handleRouteError } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string; memberId: string }> },
): Promise<Response> {
  try {
    const { ctx } = await requirePermission(request, "member.manage");
    const { id, memberId } = await context.params;
    return jsonResponse(
      await resetMemberDevices({
        ctx,
        workspaceId: id,
        memberId,
        ip: getClientIp(request),
        userAgent: request.headers.get("user-agent"),
      }),
    );
  } catch (error) {
    return handleRouteError(error);
  }
}
