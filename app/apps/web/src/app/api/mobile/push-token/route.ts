import {
  deletePushToken,
  jsonResponse,
  readJsonBody,
  registerPushToken,
  requirePermission,
} from "@absensi/auth";

import { handleRouteError } from "@/lib/api";

export const dynamic = "force-dynamic";

/** Dipanggil saat login, sesi dipulihkan, dan setiap FCM token refresh. */
export async function POST(request: Request): Promise<Response> {
  try {
    const { ctx } = await requirePermission(request, "workspace.read");
    const body = await readJsonBody(request);
    const result = await registerPushToken({
      ctx,
      token: typeof body.token === "string" ? body.token : "",
      platform: typeof body.platform === "string" ? body.platform : "",
    });
    return jsonResponse(result, 201);
  } catch (error) {
    return handleRouteError(error);
  }
}

/** Logout: hapus token perangkat ini (atau semua token user) dari server. */
export async function DELETE(request: Request): Promise<Response> {
  try {
    const { ctx } = await requirePermission(request, "workspace.read");
    const body = await readJsonBody(request).catch(() => ({}) as Record<string, unknown>);
    const result = await deletePushToken({
      ctx,
      token: typeof body.token === "string" ? body.token : undefined,
    });
    return jsonResponse(result);
  } catch (error) {
    return handleRouteError(error);
  }
}
