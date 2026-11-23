import {
  acknowledgeWarningLetter,
  getClientIp,
  jsonResponse,
  requirePermission,
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
    return jsonResponse(
      await acknowledgeWarningLetter({
        ctx,
        letterId: id,
        ip: getClientIp(request),
        userAgent: request.headers.get("user-agent"),
      }),
    );
  } catch (error) {
    return handleRouteError(error);
  }
}
