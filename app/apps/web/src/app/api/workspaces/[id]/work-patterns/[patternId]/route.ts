import {
  deactivateWorkPattern,
  getClientIp,
  jsonResponse,
  readJsonBody,
  requirePermission,
  updateWorkPattern,
} from "@absensi/auth";

import { assertWorkspaceWriteLimit, handleRouteError } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string; patternId: string }> },
): Promise<Response> {
  try {
    const { ctx } = await requirePermission(request, "member.manage");
    await assertWorkspaceWriteLimit(ctx.userId, "workspace.organization");
    const { id, patternId } = await context.params;
    return jsonResponse(
      await updateWorkPattern({
        ctx,
        workspaceId: id,
        patternId,
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
  context: { params: Promise<{ id: string; patternId: string }> },
): Promise<Response> {
  try {
    const { ctx } = await requirePermission(request, "member.manage");
    await assertWorkspaceWriteLimit(ctx.userId, "workspace.organization");
    const { id, patternId } = await context.params;
    return jsonResponse(
      await deactivateWorkPattern({
        ctx,
        workspaceId: id,
        patternId,
        ip: getClientIp(request),
        userAgent: request.headers.get("user-agent"),
      }),
    );
  } catch (error) {
    return handleRouteError(error);
  }
}
