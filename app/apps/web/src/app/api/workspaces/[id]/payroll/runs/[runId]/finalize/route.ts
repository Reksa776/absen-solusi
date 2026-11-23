import { finalizePayrollRun, getClientIp, jsonResponse, requirePermission } from "@absensi/auth";
import { handleRouteError } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function POST(request: Request, context: { params: Promise<{ id: string; runId: string }> }): Promise<Response> {
  try {
    const { ctx } = await requirePermission(request, "member.manage");
    const { id, runId } = await context.params;
    return jsonResponse(
      await finalizePayrollRun({
        ctx,
        workspaceId: id,
        runId,
        ip: getClientIp(request),
        userAgent: request.headers.get("user-agent"),
      }),
    );
  } catch (error) {
    return handleRouteError(error);
  }
}
