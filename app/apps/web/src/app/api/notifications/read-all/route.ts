import { jsonResponse, markAllNotificationsRead, requirePermission } from "@absensi/auth";

import { handleRouteError } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  try {
    const { ctx } = await requirePermission(request, "workspace.read");
    const result = await markAllNotificationsRead({ ctx });
    return jsonResponse(result);
  } catch (error) {
    return handleRouteError(error);
  }
}
