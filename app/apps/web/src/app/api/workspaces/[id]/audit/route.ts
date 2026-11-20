import { jsonResponse, listAuditLogs, requirePermission } from "@absensi/auth";

import { handleRouteError } from "@/lib/api";

export const dynamic = "force-dynamic";

function numberParam(raw: string | null): number | undefined {
  if (raw === null) return undefined;
  return raw.trim() === "" ? Number.NaN : Number(raw);
}

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const { ctx } = await requirePermission(request, "audit.read");
    const { id } = await context.params;
    const url = new URL(request.url);
    return jsonResponse(
      await listAuditLogs({
        ctx,
        workspaceId: id,
        action: url.searchParams.get("action") ?? undefined,
        limit: numberParam(url.searchParams.get("limit")),
        offset: numberParam(url.searchParams.get("offset")),
      }),
    );
  } catch (error) {
    return handleRouteError(error);
  }
}
