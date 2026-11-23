import { getClientIp, jsonResponse, payPayrollRun, readJsonBody, requirePermission } from "@absensi/auth";
import { handleRouteError } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function POST(request: Request, context: { params: Promise<{ id: string; runId: string }> }): Promise<Response> {
  try {
    const { ctx } = await requirePermission(request, "member.manage");
    const { id, runId } = await context.params;
    const body = await readJsonBody(request);
    return jsonResponse(
      await payPayrollRun({
        ctx,
        workspaceId: id,
        runId,
        paymentReference: body.paymentReference,
        ip: getClientIp(request),
        userAgent: request.headers.get("user-agent"),
      }),
    );
  } catch (error) {
    return handleRouteError(error);
  }
}
