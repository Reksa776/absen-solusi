import {
  getClientIp,
  requirePermission,
  streamPayrollCsv,
} from "@absensi/auth";

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
      return Response.json(
        { error: { code: "INVALID_FORMAT", message: "Format export harus csv" } },
        { status: 400 },
      );
    }
    const result = await streamPayrollCsv({
      ctx,
      workspaceId: id,
      from: url.searchParams.get("from") ?? "",
      to: url.searchParams.get("to") ?? "",
      memberId: url.searchParams.get("memberId") ?? undefined,
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
