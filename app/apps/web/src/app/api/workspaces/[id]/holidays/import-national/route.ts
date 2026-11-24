import {
  getClientIp,
  importNationalHolidays,
  jsonResponse,
  readJsonBody,
  requirePermission,
} from "@absensi/auth";

import { handleRouteError } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const { ctx } = await requirePermission(request, "workspace.manage");
    const { id } = await context.params;
    const body = await readJsonBody(request);
    const year = body.year;
    if (typeof year !== "number" && typeof year !== "string") {
      return jsonResponse(
        {
          error: {
            code: "INVALID_YEAR",
            message: "Pilih tahun untuk memuat hari libur nasional",
          },
        },
        400,
      );
    }
    return jsonResponse(
      await importNationalHolidays({
        ctx,
        workspaceId: id,
        year,
        ip: getClientIp(request),
        userAgent: request.headers.get("user-agent"),
      }),
    );
  } catch (error) {
    return handleRouteError(error);
  }
}
