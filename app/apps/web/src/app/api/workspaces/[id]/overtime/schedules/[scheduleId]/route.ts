import {
  cancelOvertimeSchedule,
  getClientIp,
  jsonResponse,
  requirePermission,
} from "@absensi/auth";

import { assertWorkspaceWriteLimit, handleRouteError } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string; scheduleId: string }> },
): Promise<Response> {
  try {
    const { ctx } = await requirePermission(request, "correction.review");
    await assertWorkspaceWriteLimit(ctx.userId, "correction.bulk");
    const { id, scheduleId } = await context.params;
    return jsonResponse(
      await cancelOvertimeSchedule({
        ctx,
        workspaceId: id,
        scheduleId,
        ip: getClientIp(request),
        userAgent: request.headers.get("user-agent"),
      }),
    );
  } catch (error) {
    return handleRouteError(error);
  }
}
