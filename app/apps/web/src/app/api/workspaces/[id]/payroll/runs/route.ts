import { generatePayrollRun, getClientIp, jsonResponse, listPayrollRuns, readJsonBody, requirePermission } from "@absensi/auth";
import { handleRouteError } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const { ctx } = await requirePermission(request, "member.manage");
    const { id } = await context.params;
    return jsonResponse({
      runs: await listPayrollRuns({ ctx, workspaceId: id, year: new URL(request.url).searchParams.get("year") ?? undefined }),
    });
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const { ctx } = await requirePermission(request, "member.manage");
    const { id } = await context.params;
    const body = await readJsonBody(request);
    return jsonResponse(
      await generatePayrollRun({
        ctx,
        workspaceId: id,
        year: body.year,
        month: body.month,
        notes: body.notes,
        ip: getClientIp(request),
        userAgent: request.headers.get("user-agent"),
      }),
      201,
    );
  } catch (error) {
    return handleRouteError(error);
  }
}
