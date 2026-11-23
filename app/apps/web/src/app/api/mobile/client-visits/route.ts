import { jsonResponse, listMyClientVisits, requirePermission } from "@absensi/auth";
import { handleRouteError } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  try {
    const { ctx } = await requirePermission(request, "workspace.read");
    return jsonResponse(await listMyClientVisits({ ctx, date: new URL(request.url).searchParams.get("date") ?? undefined }));
  } catch (error) {
    return handleRouteError(error);
  }
}
