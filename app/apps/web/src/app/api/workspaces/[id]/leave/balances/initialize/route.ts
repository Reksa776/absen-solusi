import {
  getClientIp,
  initializeLeaveBalances,
  jsonResponse,
  readJsonBody,
  requirePermission,
} from "@absensi/auth";

import { handleRouteError } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const { ctx } = await requirePermission(request, "correction.review");
    const { id } = await context.params;
    const body = await readJsonBody(request);
    return jsonResponse(
      await initializeLeaveBalances({
        ctx,
        workspaceId: id,
        year: body.year,
        resetUsed: body.resetUsed === true,
        ip: getClientIp(request),
        userAgent: request.headers.get("user-agent"),
      }),
    );
  } catch (error) {
    return handleRouteError(error);
  }
}
