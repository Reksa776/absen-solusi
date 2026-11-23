import { getClientIp, getClientVisitSettings, jsonResponse, readJsonBody, requirePermission, updateClientVisitSettings } from "@absensi/auth";
import { handleRouteError } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const { ctx } = await requirePermission(request, "attendance.read");
    const { id } = await context.params;
    return jsonResponse(await getClientVisitSettings({ ctx, workspaceId: id }));
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const { ctx } = await requirePermission(request, "member.manage");
    const { id } = await context.params;
    return jsonResponse(
      await updateClientVisitSettings({
        ctx,
        workspaceId: id,
        body: await readJsonBody(request),
        ip: getClientIp(request),
        userAgent: request.headers.get("user-agent"),
      }),
    );
  } catch (error) {
    return handleRouteError(error);
  }
}
