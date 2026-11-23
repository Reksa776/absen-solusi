import {
  getClientIp,
  getLeavePolicy,
  jsonResponse,
  readJsonBody,
  requirePermission,
  updateLeavePolicy,
} from "@absensi/auth";

import { handleRouteError } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const { ctx } = await requirePermission(request, "correction.review");
    const { id } = await context.params;
    return jsonResponse(await getLeavePolicy({ ctx, workspaceId: id }));
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const { ctx } = await requirePermission(request, "correction.review");
    const { id } = await context.params;
    const body = await readJsonBody(request);
    return jsonResponse(
      await updateLeavePolicy({
        ctx,
        workspaceId: id,
        annualQuotaDays: body.annualQuotaDays,
        ip: getClientIp(request),
        userAgent: request.headers.get("user-agent"),
      }),
    );
  } catch (error) {
    return handleRouteError(error);
  }
}
