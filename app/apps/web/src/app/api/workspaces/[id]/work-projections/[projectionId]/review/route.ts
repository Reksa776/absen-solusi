import { getClientIp, jsonResponse, readJsonBody, requirePermission, reviewWorkProjection } from "@absensi/auth";
import { handleRouteError } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function PATCH(request: Request, context: { params: Promise<{ id: string; projectionId: string }> }): Promise<Response> {
  try {
    const { ctx } = await requirePermission(request, "member.manage");
    const { id, projectionId } = await context.params;
    const body = await readJsonBody(request);
    return jsonResponse(
      await reviewWorkProjection({
        ctx,
        workspaceId: id,
        projectionId,
        reviewNote: body.reviewNote,
        ip: getClientIp(request),
        userAgent: request.headers.get("user-agent"),
      }),
    );
  } catch (error) {
    return handleRouteError(error);
  }
}
