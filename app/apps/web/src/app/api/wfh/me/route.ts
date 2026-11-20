import { jsonResponse, listMyWfh, requirePermission } from "@absensi/auth";

import { handleRouteError } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  try {
    const { ctx } = await requirePermission(request, "workspace.read");
    const status = new URL(request.url).searchParams.get("status") ?? undefined;
    return jsonResponse({ wfh: await listMyWfh({ ctx, status }) });
  } catch (error) {
    return handleRouteError(error);
  }
}
