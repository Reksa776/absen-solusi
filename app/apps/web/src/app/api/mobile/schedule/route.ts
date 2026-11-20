import { getMobileSchedule, jsonResponse, requirePermission } from "@absensi/auth";

import { handleRouteError } from "@/lib/api";

export const dynamic = "force-dynamic";

/** Jadwal kerja mingguan + hari libur untuk tab Profil aplikasi mobile. */
export async function GET(request: Request): Promise<Response> {
  try {
    const { ctx } = await requirePermission(request, "workspace.read");
    const url = new URL(request.url);
    const rawYear = url.searchParams.get("year");
    const year =
      rawYear === null || rawYear.trim() === "" ? undefined : Number(rawYear);
    if (
      year !== undefined &&
      (!Number.isInteger(year) || year < 2000 || year > 2100)
    ) {
      return jsonResponse(
        { error: { code: "INVALID_YEAR", message: "Parameter year tidak valid" } },
        400,
      );
    }
    const response = jsonResponse(await getMobileSchedule({ ctx, year }));
    response.headers.set("cache-control", "no-store");
    return response;
  } catch (error) {
    return handleRouteError(error);
  }
}
