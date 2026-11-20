import {
  jsonResponse,
  listWorkspaceOvertime,
  requirePermission,
} from "@absensi/auth";

import { handleRouteError } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const { ctx } = await requirePermission(request, "correction.review");
    const { id } = await context.params;
    const url = new URL(request.url);
    return jsonResponse({
      overtime: await listWorkspaceOvertime({
        ctx,
        workspaceId: id,
        status: url.searchParams.get("status") ?? undefined,
        memberId: url.searchParams.get("memberId") ?? undefined,
      }),
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
