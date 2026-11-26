import {
  deleteWorkPlanItem,
  getClientIp,
  jsonResponse,
  readJsonBody,
  requirePermission,
  updateWorkPlanItem,
} from "@absensi/auth";

import { handleRouteError } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ itemId: string }> },
): Promise<Response> {
  try {
    const { ctx } = await requirePermission(request, "workspace.read");
    const { itemId } = await context.params;
    const workPlan = await updateWorkPlanItem({
      ctx,
      itemId,
      body: await readJsonBody(request),
      ip: getClientIp(request),
      userAgent: request.headers.get("user-agent"),
    });
    return jsonResponse({ workPlan });
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ itemId: string }> },
): Promise<Response> {
  try {
    const { ctx } = await requirePermission(request, "workspace.read");
    const { itemId } = await context.params;
    const workPlan = await deleteWorkPlanItem({
      ctx,
      itemId,
      ip: getClientIp(request),
      userAgent: request.headers.get("user-agent"),
    });
    return jsonResponse({ workPlan });
  } catch (error) {
    return handleRouteError(error);
  }
}
