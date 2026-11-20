import {
  getClientIp,
  jsonResponse,
  readJsonBody,
  requirePermission,
  requireString,
  transferOwnership,
} from "@absensi/auth";

import { handleRouteError } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const { ctx } = await requirePermission(request, "workspace.manage");
    const { id } = await context.params;
    const body = await readJsonBody(request);
    const result = await transferOwnership({
      ctx,
      workspaceId: id,
      targetMemberId: requireString(body, "memberId", 36),
      ip: getClientIp(request),
      userAgent: request.headers.get("user-agent"),
    });
    return jsonResponse(result);
  } catch (error) {
    return handleRouteError(error);
  }
}
