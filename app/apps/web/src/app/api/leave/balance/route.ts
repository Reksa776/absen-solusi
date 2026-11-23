import { getMyLeaveBalance, jsonResponse, requirePermission } from "@absensi/auth";

import { handleRouteError } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  try {
    const { ctx } = await requirePermission(request, "workspace.read");
    const url = new URL(request.url);
    return jsonResponse(
      await getMyLeaveBalance({
        ctx,
        year: url.searchParams.get("year") ?? undefined,
      }),
    );
  } catch (error) {
    return handleRouteError(error);
  }
}
