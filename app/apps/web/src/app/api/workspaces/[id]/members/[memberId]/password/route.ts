import {
  getClientIp,
  HttpError,
  jsonResponse,
  readJsonBody,
  requirePermission,
  resetMemberPassword,
} from "@absensi/auth";

import { assertWorkspaceWriteLimit, handleRouteError } from "@/lib/api";

export const dynamic = "force-dynamic";

function requiredPassword(body: Record<string, unknown>): string {
  const value = body.password;
  if (typeof value !== "string" || value.length === 0) {
    throw new HttpError(400, "INVALID_INPUT", "Field password wajib diisi");
  }
  if (value.length > 128) {
    throw new HttpError(400, "INVALID_INPUT", "Field password terlalu panjang");
  }
  return value;
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string; memberId: string }> },
): Promise<Response> {
  try {
    const { ctx } = await requirePermission(request, "member.manage");
    await assertWorkspaceWriteLimit(ctx.userId, "workspace.member");
    const { id, memberId } = await context.params;
    const body = await readJsonBody(request);
    const result = await resetMemberPassword({
      ctx,
      workspaceId: id,
      memberId,
      password: requiredPassword(body),
      ip: getClientIp(request),
      userAgent: request.headers.get("user-agent"),
    });
    return jsonResponse(result);
  } catch (error) {
    return handleRouteError(error);
  }
}
