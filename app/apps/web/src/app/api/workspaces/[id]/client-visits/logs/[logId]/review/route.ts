import { getClientIp, jsonResponse, readJsonBody, requirePermission, reviewClientVisitLog } from "@absensi/auth";
import { handleRouteError } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function PATCH(request: Request, context: { params: Promise<{ id: string; logId: string }> }): Promise<Response> {
  try {
    const { ctx } = await requirePermission(request, "member.manage");
    const { id, logId } = await context.params;
    const body = await readJsonBody(request);
    return jsonResponse(
      await reviewClientVisitLog({
        ctx,
        workspaceId: id,
        logId,
        validationStatus: body.validationStatus,
        ip: getClientIp(request),
        userAgent: request.headers.get("user-agent"),
      }),
    );
  } catch (error) {
    return handleRouteError(error);
  }
}
