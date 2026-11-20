import { jsonResponse, listMyNotifications, requirePermission } from "@absensi/auth";

import { handleRouteError } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  try {
    const { ctx } = await requirePermission(request, "workspace.read");
    const url = new URL(request.url);
    const rawLimit = url.searchParams.get("limit");
    const result = await listMyNotifications({
      ctx,
      limit: rawLimit === null ? undefined : Number(rawLimit),
      unreadOnly: url.searchParams.get("unread") === "true",
    });
    return jsonResponse(result);
  } catch (error) {
    return handleRouteError(error);
  }
}
