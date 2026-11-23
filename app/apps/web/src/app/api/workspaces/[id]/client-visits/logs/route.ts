import { jsonResponse, listWorkspaceClientVisitLogs, requirePermission } from "@absensi/auth";
import { handleRouteError } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const { ctx } = await requirePermission(request, "attendance.read");
    const { id } = await context.params;
    const q = new URL(request.url).searchParams;
    return jsonResponse({
      logs: await listWorkspaceClientVisitLogs({
        ctx,
        workspaceId: id,
        from: q.get("from") ?? undefined,
        to: q.get("to") ?? undefined,
        memberId: q.get("memberId") ?? undefined,
        clientId: q.get("clientId") ?? undefined,
        validationStatus: q.get("validationStatus") ?? undefined,
      }),
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
