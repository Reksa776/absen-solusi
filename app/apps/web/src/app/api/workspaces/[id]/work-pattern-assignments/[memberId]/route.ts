import {
  getClientIp,
  jsonResponse,
  removeWorkPatternAssignment,
  requirePermission,
} from "@absensi/auth";

import { assertWorkspaceWriteLimit, handleRouteError } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string; memberId: string }> },
): Promise<Response> {
  try {
    const { ctx } = await requirePermission(request, "member.manage");
    await assertWorkspaceWriteLimit(ctx.userId, "workspace.organization");
    const { id, memberId } = await context.params;
    return jsonResponse(
      await removeWorkPatternAssignment({
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
