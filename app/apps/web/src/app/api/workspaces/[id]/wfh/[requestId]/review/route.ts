import {
  getClientIp,
  HttpError,
  jsonResponse,
  readJsonBody,
  requirePermission,
  reviewWfh,
} from "@absensi/auth";

import { handleRouteError } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string; requestId: string }> },
): Promise<Response> {
  try {
    const { ctx } = await requirePermission(request, "correction.review");
    const { id, requestId } = await context.params;
    if (ctx.tenantId !== id) {
      throw new HttpError(403, "FORBIDDEN", "Workspace tidak cocok dengan sesi");
    }
    const body = await readJsonBody(request);
    const result = await reviewWfh({
      ctx,
      wfhId: requestId,
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
