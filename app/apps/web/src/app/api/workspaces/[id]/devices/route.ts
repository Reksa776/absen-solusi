import { jsonResponse, listMemberDevices, requirePermission } from "@absensi/auth";

import { handleRouteError } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const { ctx } = await requirePermission(request, "member.read");
    const { id } = await context.params;
    const url = new URL(request.url);
    return jsonResponse({
      devices: await listMemberDevices({
        ctx,
        workspaceId: id,
        status: url.searchParams.get("status") ?? undefined,
        search: url.searchParams.get("search") ?? undefined,
      }),
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
