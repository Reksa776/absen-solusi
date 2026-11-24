import {
  createLeaveRequestByAdmin,
  getClientIp,
  jsonResponse,
  listWorkspaceLeaveRequests,
  readJsonBody,
  requirePermission,
} from "@absensi/auth";

import { handleRouteError } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const { ctx } = await requirePermission(request, "correction.review");
    const { id } = await context.params;
    const url = new URL(request.url);
    return jsonResponse({
      leave: await listWorkspaceLeaveRequests({
        ctx,
        workspaceId: id,
        status: url.searchParams.get("status") ?? undefined,
        memberId: url.searchParams.get("memberId") ?? undefined,
      }),
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
    const { ctx } = await requirePermission(request, "correction.review");
    const { id } = await context.params;
    const leave = await createLeaveRequestByAdmin({
      ctx,
      workspaceId: id,
      body: await readJsonBody(request),
      ip: getClientIp(request),
      userAgent: request.headers.get("user-agent"),
    });
    return jsonResponse(leave, 201);
  } catch (error) {
    return handleRouteError(error);
  }
}
