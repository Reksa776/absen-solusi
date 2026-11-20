import {
  getClientIp,
  jsonResponse,
  requirePermission,
  setupTwoFactor,
} from "@absensi/auth";

import { handleRouteError } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  try {
    const { ctx } = await requirePermission(request, "workspace.read");
    const result = await setupTwoFactor({
      userId: ctx.userId,
      tenantId: ctx.tenantId,
      memberId: ctx.memberId,
      ip: getClientIp(request),
      userAgent: request.headers.get("user-agent"),
    });
    return jsonResponse(result);
  } catch (error) {
    return handleRouteError(error);
  }
}
