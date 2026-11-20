import {
  bulkCorrectAttendance,
  getClientIp,
  jsonResponse,
  readJsonBody,
  requirePermission,
} from "@absensi/auth";

import { assertWorkspaceWriteLimit, handleRouteError } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const { ctx } = await requirePermission(request, "correction.review");
    const { id } = await context.params;
    await assertWorkspaceWriteLimit(ctx.userId, "correction.bulk");
    const body = await readJsonBody(request);
    const result = await bulkCorrectAttendance({
      ctx,
      workspaceId: id,
      memberIds: Array.isArray(body.memberIds)
        ? body.memberIds.filter((value): value is string => typeof value === "string")
        : [],
      date: typeof body.date === "string" ? body.date : "",
      type: typeof body.type === "string" ? body.type : "",
      timestamp: typeof body.timestamp === "string" ? body.timestamp : "",
      reason: typeof body.reason === "string" ? body.reason : "",
      ip: getClientIp(request),
      userAgent: request.headers.get("user-agent"),
    });
    return jsonResponse(result);
  } catch (error) {
    return handleRouteError(error);
  }
}
