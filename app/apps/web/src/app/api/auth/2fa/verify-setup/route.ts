import {
  getClientIp,
  jsonResponse,
  readJsonBody,
  requirePermission,
  requireString,
  verifyTwoFactorSetup,
} from "@absensi/auth";

import { handleRouteError } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  try {
    const { ctx } = await requirePermission(request, "workspace.read");
    const body = await readJsonBody(request);
    const result = await verifyTwoFactorSetup({
      userId: ctx.userId,
      code: requireString(body, "code", 32),
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
