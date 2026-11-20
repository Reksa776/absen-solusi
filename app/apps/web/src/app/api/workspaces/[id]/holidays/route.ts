import {
  createHoliday,
  getClientIp,
  jsonResponse,
  listHolidays,
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
    const { ctx } = await requirePermission(request, "workspace.manage");
    const { id } = await context.params;
    const url = new URL(request.url);
    return jsonResponse({
      holidays: await listHolidays({
        ctx,
        workspaceId: id,
        year: url.searchParams.get("year") ?? undefined,
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
    const { ctx } = await requirePermission(request, "workspace.manage");
    const { id } = await context.params;
    const body = await readJsonBody(request);
    const holiday = await createHoliday({
      ctx,
      workspaceId: id,
      date: typeof body.date === "string" ? body.date : "",
      name: typeof body.name === "string" ? body.name : "",
      ip: getClientIp(request),
      userAgent: request.headers.get("user-agent"),
    });
    return jsonResponse(holiday, 201);
  } catch (error) {
    return handleRouteError(error);
  }
}
