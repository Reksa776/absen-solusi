import {
  createPosition,
  getClientIp,
  jsonResponse,
  listPositions,
  readJsonBody,
  requirePermission,
} from "@absensi/auth";

import { assertWorkspaceWriteLimit, handleRouteError } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const { ctx } = await requirePermission(request, "member.read");
    const { id } = await context.params;
    return jsonResponse({ positions: await listPositions({ ctx, workspaceId: id }) });
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
    await assertWorkspaceWriteLimit(ctx.userId, "workspace.organization");
    const position = await createPosition({
      ctx,
      workspaceId: id,
      body: await readJsonBody(request),
      ip: getClientIp(request),
      userAgent: request.headers.get("user-agent"),
    });
    return jsonResponse(position, 201);
  } catch (error) {
    return handleRouteError(error);
  }
}
