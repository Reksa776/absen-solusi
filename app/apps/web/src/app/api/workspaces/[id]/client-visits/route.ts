import { createClientVisitSchedule, getClientIp, jsonResponse, listWorkspaceClientVisitSchedules, readJsonBody, requirePermission } from "@absensi/auth";
import { handleRouteError } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const { ctx } = await requirePermission(request, "attendance.read");
    const { id } = await context.params;
    const q = new URL(request.url).searchParams;
    return jsonResponse({
      schedules: await listWorkspaceClientVisitSchedules({
        ctx,
        workspaceId: id,
        date: q.get("date") ?? undefined,
        from: q.get("from") ?? undefined,
        to: q.get("to") ?? undefined,
        memberId: q.get("memberId") ?? undefined,
        clientId: q.get("clientId") ?? undefined,
        status: q.get("status") ?? undefined,
      }),
    });
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const { ctx } = await requirePermission(request, "member.manage");
    const { id } = await context.params;
    return jsonResponse(
      await createClientVisitSchedule({
        ctx,
        workspaceId: id,
        body: await readJsonBody(request),
        ip: getClientIp(request),
        userAgent: request.headers.get("user-agent"),
      }),
      201,
    );
  } catch (error) {
    return handleRouteError(error);
  }
}
