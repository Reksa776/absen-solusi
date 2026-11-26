import {
  extractWorkPlanItemsFromUpload,
  jsonResponse,
  requirePermission,
} from "@absensi/auth";

import { handleRouteError } from "@/lib/api";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Alias web untuk endpoint mobile pembacaan gambar rencana kerja. */
export async function POST(request: Request): Promise<Response> {
  try {
    await requirePermission(request, "workspace.read");
    const extraction = await extractWorkPlanItemsFromUpload(request);
    return jsonResponse(extraction);
  } catch (error) {
    return handleRouteError(error);
  }
}
