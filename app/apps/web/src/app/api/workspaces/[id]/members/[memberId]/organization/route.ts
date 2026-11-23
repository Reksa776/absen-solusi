import {
  assignMemberOrganization,
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
    const { ctx } = await requirePermission(request, "member.manage");
    const { id, memberId } = await context.params;
    await assertWorkspaceWriteLimit(ctx.userId, "workspace.organization");
    const body = await readJsonBody(request);
    if (!("divisionId" in body) || !("positionId" in body)) {
      return jsonResponse(
        {
          error: {
            code: "INVALID_INPUT",
            message: "divisionId dan positionId wajib ada (boleh null)",
          },
        },
        400,
      );
    }
    const divisionId = body.divisionId;
    const positionId = body.positionId;
    if (
      (divisionId !== null && typeof divisionId !== "string") ||
      (positionId !== null && typeof positionId !== "string")
    ) {
      return jsonResponse(
        { error: { code: "INVALID_INPUT", message: "Divisi/jabatan tidak valid" } },
        400,
      );
    }
    return jsonResponse(
      await assignMemberOrganization({
        ctx,
        workspaceId: id,
        memberId,
        divisionId,
        positionId,
        ip: getClientIp(request),
        userAgent: request.headers.get("user-agent"),
      }),
    );
  } catch (error) {
    return handleRouteError(error);
  }
}
