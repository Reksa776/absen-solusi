import {
  getClientIp,
  jsonResponse,
  readJsonBody,
  requirePermission,
  submitWfh,
} from "@absensi/auth";

import { handleRouteError } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  try {
    const { ctx } = await requirePermission(request, "workspace.read");
    const wfh = await submitWfh({
      ctx,
      body: await readJsonBody(request),
      ip: getClientIp(request),
      userAgent: request.headers.get("user-agent"),
    });
    return jsonResponse(wfh, 201);
  } catch (error) {
    return handleRouteError(error);
  }
}
