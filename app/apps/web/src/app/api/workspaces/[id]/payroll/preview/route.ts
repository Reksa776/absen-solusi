import { jsonResponse, previewPayroll, requirePermission } from "@absensi/auth";
import { handleRouteError } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const { ctx } = await requirePermission(request, "member.manage");
    const { id } = await context.params;
    const q = new URL(request.url).searchParams;
    return jsonResponse(await previewPayroll({ ctx, workspaceId: id, year: q.get("year"), month: q.get("month") }));
  } catch (error) {
    return handleRouteError(error);
  }
}
