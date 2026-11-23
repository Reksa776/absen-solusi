import { jsonResponse, listMyWorkPermits, requirePermission } from "@absensi/auth";

import { handleRouteError } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  try {
    const { ctx } = await requirePermission(request, "workspace.read");
    const url = new URL(request.url);
    return jsonResponse({
      permits: await listMyWorkPermits({
        ctx,
        status: url.searchParams.get("status") ?? undefined,
      }),
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
