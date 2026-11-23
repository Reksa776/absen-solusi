import {
  getClientIp,
  jsonResponse,
  readJsonBody,
  requirePermission,
  requireString,
  reviewAttendanceRecord,
} from "@absensi/auth";

import { handleRouteError } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string; attendanceId: string }> },
): Promise<Response> {
  try {
    const { ctx } = await requirePermission(request, "correction.review");
    const { id, attendanceId } = await context.params;
    const body = await readJsonBody(request);
    return jsonResponse(
      await reviewAttendanceRecord({
        ctx,
        workspaceId: id,
        attendanceId,
        action: requireString(body, "action", 16),
        rejectionReason:
          typeof body.rejectionReason === "string" ? body.rejectionReason : undefined,
        ip: getClientIp(request),
        userAgent: request.headers.get("user-agent"),
      }),
    );
  } catch (error) {
    return handleRouteError(error);
  }
}
