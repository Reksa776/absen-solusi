import { getClientIp, jsonResponse, readJsonBody, requirePermission, updateClient } from "@absensi/auth";
import { handleRouteError } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function PATCH(request: Request, context: { params: Promise<{ id: string; clientId: string }> }): Promise<Response> {
  try {
    const { ctx } = await requirePermission(request, "member.manage");
    const { id, clientId } = await context.params;
    return jsonResponse(
      await updateClient({
        ctx,
        workspaceId: id,
        clientId,
        body: await readJsonBody(request),
        ip: getClientIp(request),
        userAgent: request.headers.get("user-agent"),
      }),
    );
  } catch (error) {
    return handleRouteError(error);
  }
}
