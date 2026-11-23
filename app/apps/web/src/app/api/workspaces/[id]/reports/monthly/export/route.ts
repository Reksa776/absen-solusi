import { getClientIp, HttpError, requirePermission, streamMonthlyCsv } from "@absensi/auth";

import { handleRouteError } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const { ctx } = await requirePermission(request, "attendance.read");
    const { id } = await context.params;
    const url = new URL(request.url);
    const format = (url.searchParams.get("format") ?? "csv").toLowerCase();
    if (format !== "csv") {
      throw new HttpError(400, "INVALID_FORMAT", "Format export harus csv");
    }
    const result = await streamMonthlyCsv({
      ctx,
      workspaceId: id,
      year: url.searchParams.get("year") ?? "",
      month: url.searchParams.get("month") ?? "",
      memberId: url.searchParams.get("memberId") ?? undefined,
      divisionId: url.searchParams.get("divisionId") ?? undefined,
      positionId: url.searchParams.get("positionId") ?? undefined,
      from: url.searchParams.get("from") ?? undefined,
      to: url.searchParams.get("to") ?? undefined,
      ip: getClientIp(request),
      userAgent: request.headers.get("user-agent"),
    });
    return new Response(result.stream, {
      status: 200,
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="${result.filename}"`,
        "cache-control": "no-store",
      },
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
