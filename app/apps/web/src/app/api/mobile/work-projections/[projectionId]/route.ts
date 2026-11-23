import { getClientIp, jsonResponse, readJsonBody, requirePermission, updateWorkProjection } from "@absensi/auth";
import { handleRouteError } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function PATCH(request: Request, context: { params: Promise<{ projectionId: string }> }): Promise<Response> {
  try {
    const { ctx } = await requirePermission(request, "workspace.read");
    const { projectionId } = await context.params;
    return jsonResponse(
      await updateWorkProjection({ ctx, projectionId, body: await readJsonBody(request), ip: getClientIp(request), userAgent: request.headers.get("user-agent") }),
    );
  } catch (error) {
    return handleRouteError(error);
  }
}
