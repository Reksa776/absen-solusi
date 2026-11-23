import { getPayrollSlip, jsonResponse, requirePermission } from "@absensi/auth";
import { handleRouteError } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ id: string; runId: string }> }): Promise<Response> {
  try {
    const { ctx } = await requirePermission(request, "member.manage");
    const { id, runId } = await context.params;
    return jsonResponse(
      await getPayrollSlip({
        ctx,
        workspaceId: id,
        runId,
        memberId: new URL(request.url).searchParams.get("memberId") ?? undefined,
      }),
    );
  } catch (error) {
    return handleRouteError(error);
  }
}
