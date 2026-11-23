import {
  deleteDivision,
  getClientIp,
  jsonResponse,
  readJsonBody,
  requirePermission,
  updateDivision,
} from "@absensi/auth";

import { assertWorkspaceWriteLimit, handleRouteError } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string; divisionId: string }> },
): Promise<Response> {
  try {
    const { ctx } = await requirePermission(request, "member.manage");
    const { id, divisionId } = await context.params;
    await assertWorkspaceWriteLimit(ctx.userId, "workspace.organization");
    return jsonResponse(
      await updateDivision({
        ctx,
        workspaceId: id,
        divisionId,
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
  context: { params: Promise<{ id: string; divisionId: string }> },
): Promise<Response> {
  try {
    const { ctx } = await requirePermission(request, "member.manage");
    const { id, divisionId } = await context.params;
    await assertWorkspaceWriteLimit(ctx.userId, "workspace.organization");
    const deleted = await deleteDivision({
      ctx,
      workspaceId: id,
      divisionId,
      ip: getClientIp(request),
      userAgent: request.headers.get("user-agent"),
    });
    return jsonResponse({ deleted: true, division: deleted });
  } catch (error) {
    return handleRouteError(error);
  }
}
