import {
  attendanceRecordsToCsv,
  listAttendanceRecords,
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
    const records = await listAttendanceRecords({
      ctx,
      workspaceId: id,
      from: url.searchParams.get("from") ?? undefined,
      to: url.searchParams.get("to") ?? undefined,
      type: url.searchParams.get("type") ?? undefined,
      approvalStatus: url.searchParams.get("approvalStatus") ?? undefined,
      memberId: url.searchParams.get("memberId") ?? undefined,
      limit: 500,
    });
    return new Response(attendanceRecordsToCsv(records), {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="rekap-presensi-${new Date()
          .toISOString()
          .slice(0, 10)}.csv"`,
      },
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
