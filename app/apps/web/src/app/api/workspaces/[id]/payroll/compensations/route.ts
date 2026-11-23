import { jsonResponse, listMemberCompensations, requirePermission } from "@absensi/auth";
import { handleRouteError } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const { ctx } = await requirePermission(request, "member.manage");
    const { id } = await context.params;
    return jsonResponse({ compensations: await listMemberCompensations({ ctx, workspaceId: id }) });
  } catch (error) {
    return handleRouteError(error);
  }
}
