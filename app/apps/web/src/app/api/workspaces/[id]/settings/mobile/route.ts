import {
  getClientIp,
  getMobileSettings,
  jsonResponse,
  readJsonBody,
  requirePermission,
  updateMobileSettings,
} from "@absensi/auth";

import { handleRouteError } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const { ctx } = await requirePermission(request, "member.read");
    const { id } = await context.params;
    return jsonResponse(await getMobileSettings({ ctx, workspaceId: id }));
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const { ctx } = await requirePermission(request, "member.manage");
    const { id } = await context.params;
    const body = await readJsonBody(request);
    const requireDeviceApproval = body.requireDeviceApproval;
    const autoApproveFirstDevice = body.autoApproveFirstDevice;
    if (
      requireDeviceApproval === undefined &&
      autoApproveFirstDevice === undefined
    ) {
      return jsonResponse(
        {
          error: {
            code: "INVALID_INPUT",
            message: "Minimal satu pengaturan perangkat wajib diisi",
          },
        },
        400,
      );
    }
    if (
      (requireDeviceApproval !== undefined &&
        typeof requireDeviceApproval !== "boolean") ||
      (autoApproveFirstDevice !== undefined &&
        typeof autoApproveFirstDevice !== "boolean")
    ) {
      return jsonResponse(
        {
          error: {
            code: "INVALID_INPUT",
            message: "Pengaturan perangkat wajib berupa boolean",
          },
        },
        400,
      );
    }
    return jsonResponse(
      await updateMobileSettings({
        ctx,
        workspaceId: id,
        requireDeviceApproval,
        autoApproveFirstDevice,
        ip: getClientIp(request),
        userAgent: request.headers.get("user-agent"),
      }),
    );
  } catch (error) {
    return handleRouteError(error);
  }
}
