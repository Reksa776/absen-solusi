import {
  createShift,
  getClientIp,
  jsonResponse,
  listShifts,
  readJsonBody,
  requirePermission,
} from "@absensi/auth";

import { assertWorkspaceWriteLimit, handleRouteError } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const { ctx } = await requirePermission(request, "office.manage");
    const { id } = await context.params;
    return jsonResponse({ shifts: await listShifts({ ctx, workspaceId: id }) });
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const { ctx } = await requirePermission(request, "office.manage");
    const { id } = await context.params;
    await assertWorkspaceWriteLimit(ctx.userId, "workspace.office");
    const shift = await createShift({
      ctx,
      workspaceId: id,
      body: await readJsonBody(request),
      ip: getClientIp(request),
      userAgent: request.headers.get("user-agent"),
    });
    return jsonResponse(shift, 201);
  } catch (error) {
    return handleRouteError(error);
  }
}
