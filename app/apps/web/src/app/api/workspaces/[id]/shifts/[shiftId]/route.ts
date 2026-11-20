import {
  deactivateShift,
  getClientIp,
  jsonResponse,
  readJsonBody,
  requirePermission,
  updateShift,
} from "@absensi/auth";

import { assertWorkspaceWriteLimit, handleRouteError } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string; shiftId: string }> },
): Promise<Response> {
  try {
    const { ctx } = await requirePermission(request, "office.manage");
    const { id, shiftId } = await context.params;
    await assertWorkspaceWriteLimit(ctx.userId, "workspace.office");
    const shift = await updateShift({
      ctx,
      workspaceId: id,
      shiftId,
      body: await readJsonBody(request),
      ip: getClientIp(request),
      userAgent: request.headers.get("user-agent"),
    });
    return jsonResponse(shift);
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string; shiftId: string }> },
): Promise<Response> {
  try {
    const { ctx } = await requirePermission(request, "office.manage");
    const { id, shiftId } = await context.params;
    await assertWorkspaceWriteLimit(ctx.userId, "workspace.office");
    const shift = await deactivateShift({
      ctx,
      workspaceId: id,
      shiftId,
      ip: getClientIp(request),
      userAgent: request.headers.get("user-agent"),
    });
    return jsonResponse(shift);
  } catch (error) {
    return handleRouteError(error);
  }
}
