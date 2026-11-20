import {
  assignMemberOffice,
  getClientIp,
  jsonResponse,
  readJsonBody,
  requirePermission,
} from "@absensi/auth";

import { assertWorkspaceWriteLimit, handleRouteError } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string; memberId: string }> },
): Promise<Response> {
  try {
    const { ctx } = await requirePermission(request, "office.manage");
    const { id, memberId } = await context.params;
    await assertWorkspaceWriteLimit(ctx.userId, "workspace.office");
    const body = await readJsonBody(request);
    if (!("officeLocationId" in body)) {
      return jsonResponse(
        { error: { code: "INVALID_INPUT", message: "officeLocationId wajib ada" } },
        400,
      );
    }
    const officeLocationId = body.officeLocationId;
    if (officeLocationId !== null && typeof officeLocationId !== "string") {
      return jsonResponse(
        { error: { code: "INVALID_INPUT", message: "officeLocationId tidak valid" } },
        400,
      );
    }
    const result = await assignMemberOffice({
      ctx,
      workspaceId: id,
      memberId,
      officeLocationId,
      ip: getClientIp(request),
      userAgent: request.headers.get("user-agent"),
    });
    return jsonResponse(result);
  } catch (error) {
    return handleRouteError(error);
  }
}
