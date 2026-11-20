import { jsonResponse, markNotificationRead, requirePermission } from "@absensi/auth";

import { handleRouteError } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const { ctx } = await requirePermission(request, "workspace.read");
    const { id } = await context.params;
    const result = await markNotificationRead({ ctx, notificationId: id });
    return jsonResponse(result);
  } catch (error) {
    return handleRouteError(error);
  }
}
