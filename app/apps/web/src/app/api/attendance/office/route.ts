import {
  jsonResponse,
  listActiveOffices,
  requirePermission,
} from "@absensi/auth";

import { handleRouteError } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  try {
    const { ctx } = await requirePermission(request, "workspace.read");
    const offices = await listActiveOffices(ctx);
    return jsonResponse({ office: offices[0] ?? null, offices });
  } catch (error) {
    return handleRouteError(error);
  }
}
