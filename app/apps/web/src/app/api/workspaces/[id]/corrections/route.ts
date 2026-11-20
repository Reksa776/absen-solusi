import {
  jsonResponse,
  listWorkspaceCorrections,
  requirePermission,
} from "@absensi/auth";

import { handleRouteError } from "@/lib/api";

export const dynamic = "force-dynamic";

function numericQueryParam(raw: string | null): number | undefined {
  if (raw === null) return undefined;
  const trimmed = raw.trim();
  return trimmed === "" ? Number.NaN : Number(trimmed);
}

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const { ctx } = await requirePermission(request, "correction.read");
    const { id } = await context.params;
    const url = new URL(request.url);
    return jsonResponse(
      await listWorkspaceCorrections({
        ctx,
        workspaceId: id,
        status: url.searchParams.get("status") ?? undefined,
        memberId: url.searchParams.get("memberId") ?? undefined,
        from: url.searchParams.get("from") ?? undefined,
        to: url.searchParams.get("to") ?? undefined,
        limit: numericQueryParam(url.searchParams.get("limit")),
        offset: numericQueryParam(url.searchParams.get("offset")),
      }),
    );
  } catch (error) {
    return handleRouteError(error);
  }
}
