import { jsonResponse, listAttendanceRecords, requirePermission } from "@absensi/auth";

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
      records: await listAttendanceRecords({
        ctx,
        workspaceId: id,
        date: url.searchParams.get("date") ?? undefined,
        from: url.searchParams.get("from") ?? undefined,
        to: url.searchParams.get("to") ?? undefined,
        type: url.searchParams.get("type") ?? undefined,
        approvalStatus: url.searchParams.get("approvalStatus") ?? undefined,
        memberId: url.searchParams.get("memberId") ?? undefined,
        limit: Number(url.searchParams.get("limit") ?? 250),
      }),
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
