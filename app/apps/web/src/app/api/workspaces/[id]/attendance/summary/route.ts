import {
  getAttendancePeriodSummary,
  jsonResponse,
  requirePermission,
} from "@absensi/auth";

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
    const summary = await getAttendancePeriodSummary({
      ctx,
      workspaceId: id,
      startDate: url.searchParams.get("startDate") ?? "",
      endDate: url.searchParams.get("endDate") ?? "",
      memberId: url.searchParams.get("memberId") || undefined,
    });
    return jsonResponse(summary);
  } catch (error) {
    return handleRouteError(error);
  }
}
