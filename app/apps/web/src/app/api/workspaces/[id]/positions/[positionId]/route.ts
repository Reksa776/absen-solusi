import {
  deletePosition,
  getClientIp,
  jsonResponse,
  readJsonBody,
  requirePermission,
  updatePosition,
} from "@absensi/auth";

import { assertWorkspaceWriteLimit, handleRouteError } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string; positionId: string }> },
): Promise<Response> {
  try {
    const { ctx } = await requirePermission(request, "member.manage");
    const { id, positionId } = await context.params;
    await assertWorkspaceWriteLimit(ctx.userId, "workspace.organization");
    return jsonResponse(
      await updatePosition({
        ctx,
        workspaceId: id,
        positionId,
        body: await readJsonBody(request),
        ip: getClientIp(request),
        userAgent: request.headers.get("user-agent"),
      }),
    );
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string; positionId: string }> },
): Promise<Response> {
  try {
    const { ctx } = await requirePermission(request, "member.manage");
    const { id, positionId } = await context.params;
    await assertWorkspaceWriteLimit(ctx.userId, "workspace.organization");
    const deleted = await deletePosition({
      ctx,
      workspaceId: id,
      positionId,
      ip: getClientIp(request),
      userAgent: request.headers.get("user-agent"),
    });
    return jsonResponse({ deleted: true, position: deleted });
  } catch (error) {
    return handleRouteError(error);
  }
}
