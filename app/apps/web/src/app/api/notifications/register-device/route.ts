import { jsonResponse, readJsonBody, registerDeviceToken, requirePermission } from "@absensi/auth";

import { handleRouteError } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  try {
    // Bearer (mobile) maupun cookie (web) diterima lewat satu session store.
    const { ctx } = await requirePermission(request, "workspace.read");
    const body = await readJsonBody(request);
    const result = await registerDeviceToken({
      ctx,
      token: typeof body.token === "string" ? body.token : "",
      platform: typeof body.platform === "string" ? body.platform : "",
    });
    return jsonResponse(result, 201);
  } catch (error) {
    return handleRouteError(error);
  }
}
