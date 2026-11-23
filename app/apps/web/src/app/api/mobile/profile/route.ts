import { getMyOrganization, jsonResponse, requirePermission } from "@absensi/auth";

import { handleRouteError } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  try {
    const { ctx } = await requirePermission(request, "workspace.read");
    return jsonResponse(await getMyOrganization({ ctx }));
  } catch (error) {
    return handleRouteError(error);
  }
}
