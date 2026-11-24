import {
  getClientIp,
  jsonResponse,
  readJsonBody,
  requirePermission,
  updateMemberEmployee,
} from "@absensi/auth";

import { assertWorkspaceWriteLimit, handleRouteError } from "@/lib/api";

export const dynamic = "force-dynamic";

function optionalId(body: Record<string, unknown>, field: string): string | null | undefined {
  if (!(field in body)) return undefined;
  const value = body[field];
  if (value === null || value === "") return null;
  if (typeof value !== "string") return undefined;
  return value.trim();
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string; memberId: string }> },
): Promise<Response> {
  try {
    const { ctx } = await requirePermission(request, "member.manage");
    const { id, memberId } = await context.params;
    await assertWorkspaceWriteLimit(ctx.userId, "workspace.member");
    const body = await readJsonBody(request);
    const result = await updateMemberEmployee({
      ctx,
      workspaceId: id,
      memberId,
      name: typeof body.name === "string" ? body.name : undefined,
      status: typeof body.status === "string" ? body.status : undefined,
      officeLocationId: optionalId(body, "officeLocationId"),
      divisionId: optionalId(body, "divisionId"),
      positionId: optionalId(body, "positionId"),
      ip: getClientIp(request),
      userAgent: request.headers.get("user-agent"),
    });
    return jsonResponse(result);
  } catch (error) {
    return handleRouteError(error);
  }
}
