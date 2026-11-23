import { createWorkProjection, getClientIp, jsonResponse, listMyWorkProjections, readJsonBody, requirePermission } from "@absensi/auth";
import { handleRouteError } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  try {
    const { ctx } = await requirePermission(request, "workspace.read");
    return jsonResponse({ projections: await listMyWorkProjections({ ctx, status: new URL(request.url).searchParams.get("status") ?? undefined }) });
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    const { ctx } = await requirePermission(request, "workspace.read");
    return jsonResponse(
      await createWorkProjection({ ctx, body: await readJsonBody(request), ip: getClientIp(request), userAgent: request.headers.get("user-agent") }),
      201,
    );
  } catch (error) {
    return handleRouteError(error);
  }
}
