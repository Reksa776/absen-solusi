import { jsonResponse, listWorkspaceAttendance, requirePermission } from "@absensi/auth";

import { handleRouteError } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const { ctx } = await requirePermission(request, "attendance.read");
    const { id } = await context.params;
    const url = new URL(request.url);
    return jsonResponse({
      attendance: await listWorkspaceAttendance({
        ctx,
        workspaceId: id,
        date: url.searchParams.get("date") ?? undefined,
        memberId: url.searchParams.get("memberId") ?? undefined,
      }),
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
