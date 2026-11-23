import { jsonResponse, listWorkspaceWorkProjections, requirePermission } from "@absensi/auth";
import { handleRouteError } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const { ctx } = await requirePermission(request, "attendance.read");
    const { id } = await context.params;
    const q = new URL(request.url).searchParams;
    return jsonResponse({
      projections: await listWorkspaceWorkProjections({
        ctx,
        workspaceId: id,
        memberId: q.get("memberId") ?? undefined,
        divisionId: q.get("divisionId") ?? undefined,
        status: q.get("status") ?? undefined,
        from: q.get("from") ?? undefined,
        to: q.get("to") ?? undefined,
      }),
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
