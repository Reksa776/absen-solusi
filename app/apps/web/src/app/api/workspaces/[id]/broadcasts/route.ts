import {
  createBroadcast,
  getClientIp,
  jsonResponse,
  listWorkspaceBroadcasts,
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
    return jsonResponse({
      broadcasts: await listWorkspaceBroadcasts({ ctx, workspaceId: id }),
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
      await createBroadcast({
        ctx,
        workspaceId: id,
        title: body.title,
        content: body.content,
        audienceType: body.audienceType,
        divisionId: body.divisionId,
        locationId: body.locationId,
        priority: body.priority,
        publishNow: body.publishNow === true,
        ip: getClientIp(request),
        userAgent: request.headers.get("user-agent"),
      }),
      201,
    );
  } catch (error) {
    return handleRouteError(error);
  }
}
