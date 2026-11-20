import {
  assignShift,
  getClientIp,
  jsonResponse,
  listShiftAssignments,
  readJsonBody,
  requirePermission,
  requireString,
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
    const url = new URL(request.url);
    return jsonResponse({
      assignments: await listShiftAssignments({
        ctx,
        workspaceId: id,
        date: url.searchParams.get("date") ?? undefined,
      }),
    });
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
    const body = await readJsonBody(request);
    const workDate =
      typeof body.workDate === "string" && body.workDate.trim() !== ""
        ? body.workDate.trim()
        : null;
    const result = await assignShift({
      ctx,
      workspaceId: id,
      memberId: requireString(body, "memberId", 36),
      shiftId: requireString(body, "shiftId", 36),
      workDate,
      ip: getClientIp(request),
      userAgent: request.headers.get("user-agent"),
    });
    return jsonResponse(result, 201);
  } catch (error) {
    return handleRouteError(error);
  }
}
