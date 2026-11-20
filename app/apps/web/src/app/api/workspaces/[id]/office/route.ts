import {
  createOffice,
  getClientIp,
  jsonResponse,
  listOffices,
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
    const { ctx } = await requirePermission(request, "office.manage");
    const { id } = await context.params;
    return jsonResponse({ offices: await listOffices({ ctx, workspaceId: id }) });
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const { ctx } = await requirePermission(request, "office.manage");
    const { id } = await context.params;
    await assertWorkspaceWriteLimit(ctx.userId, "workspace.office");
    const body = await readJsonBody(request);
    const office = await createOffice({
      ctx,
      workspaceId: id,
      office: body,
      ip: getClientIp(request),
      userAgent: request.headers.get("user-agent"),
    });
    return jsonResponse(office, 201);
  } catch (error) {
    return handleRouteError(error);
  }
}
