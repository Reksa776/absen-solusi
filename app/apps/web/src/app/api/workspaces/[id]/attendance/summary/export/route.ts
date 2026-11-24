import {
  exportAttendancePeriodCsv,
  getClientIp,
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
    const startDate = url.searchParams.get("startDate") ?? "";
    const endDate = url.searchParams.get("endDate") ?? "";
    const exportResult = await exportAttendancePeriodCsv({
      ctx,
      workspaceId: id,
      startDate,
      endDate,
      memberId: url.searchParams.get("memberId") || undefined,
      ip: getClientIp(request),
      userAgent: request.headers.get("user-agent"),
    });
    return new Response(exportResult.csv, {
      status: 200,
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="${exportResult.filename}"`,
        "cache-control": "private, no-store",
        "x-content-type-options": "nosniff",
      },
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
