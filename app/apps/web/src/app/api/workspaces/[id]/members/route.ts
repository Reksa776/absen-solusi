import {
  createEmailTransportFromEnv,
  getClientIp,
  invitationResponse,
  inviteMember,
  jsonResponse,
  listWorkspaceMembers,
  logger,
  readJsonBody,
  requirePermission,
  requireString,
  sendInvitationEmail,
} from "@absensi/auth";

import { assertWorkspaceWriteLimit, handleRouteError } from "@/lib/api";

export const dynamic = "force-dynamic";

function numericQueryParam(raw: string | null): number | undefined {
  if (raw === null) return undefined;
  const trimmed = raw.trim();
  return trimmed === "" ? Number.NaN : Number(trimmed);
}

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const { ctx } = await requirePermission(request, "member.read");
    const { id } = await context.params;
    const url = new URL(request.url);
    const result = await listWorkspaceMembers({
      ctx,
      workspaceId: id,
      limit: numericQueryParam(url.searchParams.get("limit")),
      offset: numericQueryParam(url.searchParams.get("offset")),
    });
    return jsonResponse(result);
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const { ctx } = await requirePermission(request, "member.invite");
    await assertWorkspaceWriteLimit(ctx.userId, "workspace.invite");
    const { id } = await context.params;
    const body = await readJsonBody(request);
    const result = await inviteMember({
      ctx,
      workspaceId: id,
      email: requireString(body, "email", 255),
      role: typeof body.role === "string" ? body.role : undefined,
      ip: getClientIp(request),
      userAgent: request.headers.get("user-agent"),
    });
    try {
      await sendInvitationEmail(createEmailTransportFromEnv(), {
        to: result.email,
        token: result.token,
        expiresAt: result.expiresAt,
      });
    } catch (emailError) {
      // Undangan sudah tersimpan; kegagalan transport dicatat tanpa token/hash.
      logger.error("invitation email failed", { error: emailError, invitationId: result.invitationId });
    }
    return jsonResponse(
      invitationResponse(result, {
        echoDevToken: process.env.S1_INVITATION_TOKEN_ECHO === "true",
      }),
      201,
    );
  } catch (error) {
    return handleRouteError(error);
  }
}
