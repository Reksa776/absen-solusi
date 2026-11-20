import { getPayrollSummary, jsonResponse, requirePermission } from "@absensi/auth";

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
    return jsonResponse(
      await getPayrollSummary({
        ctx,
        workspaceId: id,
        from: url.searchParams.get("from") ?? "",
        to: url.searchParams.get("to") ?? "",
        memberId: url.searchParams.get("memberId") ?? undefined,
      }),
    );
  } catch (error) {
    return handleRouteError(error);
  }
}
