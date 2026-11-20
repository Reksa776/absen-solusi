import { jsonResponse, listMyAttendance, requirePermission } from "@absensi/auth";

import { handleRouteError } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  try {
    const { ctx } = await requirePermission(request, "workspace.read");
    const url = new URL(request.url);
    return jsonResponse({
      attendance: await listMyAttendance({
        ctx,
        from: url.searchParams.get("from") ?? undefined,
        to: url.searchParams.get("to") ?? undefined,
      }),
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
