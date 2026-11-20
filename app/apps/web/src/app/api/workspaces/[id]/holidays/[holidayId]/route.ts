import {
  deleteHoliday,
  getClientIp,
  jsonResponse,
  requirePermission,
} from "@absensi/auth";

import { handleRouteError } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string; holidayId: string }> },
): Promise<Response> {
  try {
    const { ctx } = await requirePermission(request, "workspace.manage");
    const { id, holidayId } = await context.params;
    const deleted = await deleteHoliday({
      ctx,
      workspaceId: id,
      holidayId,
      ip: getClientIp(request),
      userAgent: request.headers.get("user-agent"),
    });
    return jsonResponse({ deleted: true, holiday: deleted });
  } catch (error) {
    return handleRouteError(error);
  }
}
