import {
  getClientIp,
  jsonResponse,
  readJsonBody,
  requirePermission,
  reviewWorkPermit,
} from "@absensi/auth";

import { handleRouteError } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const { ctx } = await requirePermission(request, "correction.review");
    const { id } = await context.params;
    const body = await readJsonBody(request);
    return jsonResponse(
      await reviewWorkPermit({
        ctx,
        permitId: id,
        action: typeof body.action === "string" ? body.action : "",
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
