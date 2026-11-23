import {
  createOvertimeSchedule,
  getClientIp,
  jsonResponse,
  listOvertimeSchedules,
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
    const { ctx } = await requirePermission(request, "correction.review");
    const { id } = await context.params;
    const url = new URL(request.url);
    return jsonResponse({
      schedules: await listOvertimeSchedules({
        ctx,
        workspaceId: id,
        from: url.searchParams.get("from") ?? undefined,
        to: url.searchParams.get("to") ?? undefined,
        memberId: url.searchParams.get("memberId") ?? undefined,
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
    const { ctx } = await requirePermission(request, "correction.review");
    await assertWorkspaceWriteLimit(ctx.userId, "correction.bulk");
    const { id } = await context.params;
    return jsonResponse(
      await createOvertimeSchedule({
        ctx,
        workspaceId: id,
        body: await readJsonBody(request),
        ip: getClientIp(request),
        userAgent: request.headers.get("user-agent"),
      }),
      201,
    );
  } catch (error) {
    return handleRouteError(error);
  }
}
