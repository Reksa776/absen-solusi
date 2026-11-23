import {
  createWarningLetter,
  getClientIp,
  jsonResponse,
  listWorkspaceWarningLetters,
  readJsonBody,
  requirePermission,
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
    const url = new URL(request.url);
    return jsonResponse({
      letters: await listWorkspaceWarningLetters({
        ctx,
        workspaceId: id,
        memberId: url.searchParams.get("memberId") ?? undefined,
        status: url.searchParams.get("status") ?? undefined,
      }),
    });
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const { ctx } = await requirePermission(request, "member.manage");
    const { id } = await context.params;
    const body = await readJsonBody(request);
    return jsonResponse(
      await createWarningLetter({
        ctx,
        workspaceId: id,
        memberId: body.memberId,
        level: body.level,
        letterNumber: body.letterNumber,
        issuedAt: body.issuedAt,
        validUntil: body.validUntil,
        violationReason: body.violationReason,
        ip: getClientIp(request),
        userAgent: request.headers.get("user-agent"),
      }),
      201,
    );
  } catch (error) {
    return handleRouteError(error);
  }
}
