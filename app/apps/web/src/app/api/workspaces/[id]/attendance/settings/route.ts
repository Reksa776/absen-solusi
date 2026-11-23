import {
  getAttendanceSetting,
  getClientIp,
  jsonResponse,
  readJsonBody,
  requirePermission,
  updateAttendanceSetting,
} from "@absensi/auth";

import { assertWorkspaceWriteLimit, handleRouteError } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const { ctx } = await requirePermission(request, "attendance.read");
    const { id } = await context.params;
    return jsonResponse(await getAttendanceSetting({ ctx, workspaceId: id }));
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const { ctx } = await requirePermission(request, "member.manage");
    await assertWorkspaceWriteLimit(ctx.userId, "workspace.member");
    const { id } = await context.params;
    return jsonResponse(
      await updateAttendanceSetting({
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
