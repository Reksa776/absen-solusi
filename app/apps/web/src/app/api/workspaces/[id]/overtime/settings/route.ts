import {
  getClientIp,
  getOvertimeSetting,
  jsonResponse,
  readJsonBody,
  requirePermission,
  updateOvertimeSetting,
} from "@absensi/auth";

import { assertWorkspaceWriteLimit, handleRouteError } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const { ctx } = await requirePermission(request, "correction.review");
    const { id } = await context.params;
    return jsonResponse(await getOvertimeSetting({ ctx, workspaceId: id }));
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
    await assertWorkspaceWriteLimit(ctx.userId, "correction.bulk");
    const { id } = await context.params;
    return jsonResponse(
      await updateOvertimeSetting({
        ctx,
        workspaceId: id,
        body: await readJsonBody(request),
        ip: getClientIp(request),
        userAgent: request.headers.get("user-agent"),
      }),
    );
  } catch (error) {
    return handleRouteError(error);
  }
}
