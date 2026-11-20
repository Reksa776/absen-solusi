import {
  changeMemberRole,
  getClientIp,
  jsonResponse,
  readJsonBody,
  requirePermission,
  requireString,
} from "@absensi/auth";

import { assertWorkspaceWriteLimit, handleRouteError } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string; memberId: string }> },
): Promise<Response> {
  try {
    const { ctx } = await requirePermission(request, "role.manage");
    await assertWorkspaceWriteLimit(ctx.userId, "workspace.role");
    const { id, memberId } = await context.params;
    const body = await readJsonBody(request);
    const result = await changeMemberRole({
      ctx,
      workspaceId: id,
      memberId,
      role: requireString(body, "role", 40),
      ip: getClientIp(request),
      userAgent: request.headers.get("user-agent"),
    });
    return jsonResponse(result);
  } catch (error) {
    return handleRouteError(error);
  }
}
