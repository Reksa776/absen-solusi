import { getTodayWorkPlan, jsonResponse, requirePermission } from "@absensi/auth";

import { handleRouteError } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  try {
    const { ctx } = await requirePermission(request, "workspace.read");
    const date = new URL(request.url).searchParams.get("date") ?? undefined;
    const workPlan = await getTodayWorkPlan({ ctx, date });
    return jsonResponse({ workPlan });
  } catch (error) {
    return handleRouteError(error);
  }
}
