import {
  createDivision,
  getClientIp,
  jsonResponse,
  listDivisions,
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
    return jsonResponse({ divisions: await listDivisions({ ctx, workspaceId: id }) });
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
    const division = await createDivision({
      ctx,
      workspaceId: id,
      body: await readJsonBody(request),
      ip: getClientIp(request),
      userAgent: request.headers.get("user-agent"),
    });
    return jsonResponse(division, 201);
  } catch (error) {
    return handleRouteError(error);
  }
}
