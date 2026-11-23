import { getPayrollSlip, jsonResponse, requirePermission } from "@absensi/auth";
import { handleRouteError } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ runId: string }> }): Promise<Response> {
  try {
    const { ctx } = await requirePermission(request, "workspace.read");
    const { runId } = await context.params;
    return jsonResponse(await getPayrollSlip({ ctx, runId }));
  } catch (error) {
    return handleRouteError(error);
  }
}
