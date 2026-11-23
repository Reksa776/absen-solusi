import {
  deleteApprovalWorkflow,
  getClientIp,
  jsonResponse,
  readJsonBody,
  requirePermission,
  saveApprovalWorkflow,
} from "@absensi/auth";

import { handleRouteError } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string; requestType: string }> },
): Promise<Response> {
  try {
    const { ctx } = await requirePermission(request, "member.manage");
    const { id, requestType } = await context.params;
    const body = await readJsonBody(request);
    return jsonResponse(
      await saveApprovalWorkflow({
        ctx,
        workspaceId: id,
        requestType,
        steps: body.steps,
        ...(typeof body.isActive === "boolean" ? { isActive: body.isActive } : {}),
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
  context: { params: Promise<{ id: string; requestType: string }> },
): Promise<Response> {
  try {
    const { ctx } = await requirePermission(request, "member.manage");
    const { id, requestType } = await context.params;
    await deleteApprovalWorkflow({
      ctx,
      workspaceId: id,
      requestType,
      ip: getClientIp(request),
      userAgent: request.headers.get("user-agent"),
    });
    return jsonResponse({ deleted: true });
  } catch (error) {
    return handleRouteError(error);
  }
}
