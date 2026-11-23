import {
  getMyDevice,
  jsonResponse,
  normalizeDeviceIdentity,
  requirePermission,
} from "@absensi/auth";

import { handleRouteError } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  try {
    const { ctx } = await requirePermission(request, "workspace.read");
    const identity = normalizeDeviceIdentity({
      deviceId: request.headers.get("x-device-id"),
      deviceName: request.headers.get("x-device-name"),
      platform: request.headers.get("x-device-platform"),
    });
    return jsonResponse({ device: await getMyDevice({ ctx, identity }) });
  } catch (error) {
    return handleRouteError(error);
  }
}
