import { getTodayDashboard, jsonResponse, requirePermission } from "@absensi/auth";

import { handleRouteError } from "@/lib/api";

export const dynamic = "force-dynamic";

function numberParam(raw: string | null): number | undefined {
  if (raw === null || raw.trim() === "") return undefined;
  return Number(raw);
}

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const { ctx } = await requirePermission(request, "attendance.read");
    const { id } = await context.params;
    const url = new URL(request.url);
    return jsonResponse(
      await getTodayDashboard({
        ctx,
        workspaceId: id,
        date: url.searchParams.get("date") ?? undefined,
        memberId: url.searchParams.get("memberId") ?? undefined,
        status: url.searchParams.get("status") ?? undefined,
        limit: numberParam(url.searchParams.get("limit")),
        offset: numberParam(url.searchParams.get("offset")),
      }),
    );
  } catch (error) {
    return handleRouteError(error);
  }
}
