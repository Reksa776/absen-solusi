import { createClient, getClientIp, jsonResponse, listClients, readJsonBody, requirePermission } from "@absensi/auth";
import { handleRouteError } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const { ctx } = await requirePermission(request, "attendance.read");
    const { id } = await context.params;
    const url = new URL(request.url);
    return jsonResponse({
      clients: await listClients({
        ctx,
        workspaceId: id,
        search: url.searchParams.get("search") ?? undefined,
        activeOnly: url.searchParams.get("activeOnly") === "true",
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
      await createClient({
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
