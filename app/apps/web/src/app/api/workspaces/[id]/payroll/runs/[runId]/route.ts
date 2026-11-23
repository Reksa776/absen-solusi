import { getPayrollRun, jsonResponse, requirePermission } from "@absensi/auth";
import { handleRouteError } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ id: string; runId: string }> }): Promise<Response> {
  try {
    const { ctx } = await requirePermission(request, "member.manage");
    const { id, runId } = await context.params;
    return jsonResponse(await getPayrollRun({ ctx, workspaceId: id, runId }));
  } catch (error) {
    return handleRouteError(error);
  }
}
