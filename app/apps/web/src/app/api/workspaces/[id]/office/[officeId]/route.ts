import {
  getClientIp,
  jsonResponse,
  readJsonBody,
  requirePermission,
  updateOffice,
} from "@absensi/auth";

import { assertWorkspaceWriteLimit, handleRouteError } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string; officeId: string }> },
): Promise<Response> {
  try {
    const { ctx } = await requirePermission(request, "office.manage");
    const { id, officeId } = await context.params;
    await assertWorkspaceWriteLimit(ctx.userId, "workspace.office");
    const body = await readJsonBody(request);
    const office = await updateOffice({
      ctx,
      workspaceId: id,
      officeId,
      office: body,
      ip: getClientIp(request),
      userAgent: request.headers.get("user-agent"),
    });
    return jsonResponse(office);
  } catch (error) {
    return handleRouteError(error);
  }
}
