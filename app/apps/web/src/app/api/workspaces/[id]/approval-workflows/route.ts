import {
  getClientIp,
  jsonResponse,
  listApprovalWorkflows,
  readJsonBody,
  requirePermission,
  requireString,
  saveApprovalWorkflow,
} from "@absensi/auth";

import { handleRouteError } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const { ctx } = await requirePermission(request, "member.read");
    const { id } = await context.params;
    return jsonResponse({
      workflows: await listApprovalWorkflows({ ctx, workspaceId: id }),
    });
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const { ctx } = await requirePermission(request, "member.manage");
    const { id } = await context.params;
    const body = await readJsonBody(request);
    return jsonResponse(
      await saveApprovalWorkflow({
        ctx,
        workspaceId: id,
        requestType: requireString(body, "requestType", 32),
        steps: body.steps,
        ...(typeof body.isActive === "boolean" ? { isActive: body.isActive } : {}),
        ip: getClientIp(request),
        userAgent: request.headers.get("user-agent"),
      }),
      201,
    );
  } catch (error) {
    return handleRouteError(error);
  }
}
