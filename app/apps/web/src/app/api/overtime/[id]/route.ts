import {
  getClientIp,
  jsonResponse,
  readJsonBody,
  requirePermission,
  reviewOvertime,
} from "@absensi/auth";

import { handleRouteError } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const { ctx } = await requirePermission(request, "workspace.read");
    const { id } = await context.params;
    const body = await readJsonBody(request);
    const result = await reviewOvertime({
      ctx,
      overtimeId: id,
      action: typeof body.action === "string" ? body.action : "",
      rejectionReason:
        typeof body.rejectionReason === "string" ? body.rejectionReason : undefined,
      ip: getClientIp(request),
      userAgent: request.headers.get("user-agent"),
    });
    return jsonResponse(result);
  } catch (error) {
    return handleRouteError(error);
  }
}
