import {
  extractWorkPlanItemsFromUpload,
  jsonResponse,
  requirePermission,
} from "@absensi/auth";

import { handleRouteError } from "@/lib/api";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Baca foto/whiteboard/screenshot rencana kerja menjadi daftar tugas.
 * Vision LLM dipakai lebih dulu bila API key tersedia, lalu OCR lokal.
 */
export async function POST(request: Request): Promise<Response> {
  try {
    await requirePermission(request, "workspace.read");
    const extraction = await extractWorkPlanItemsFromUpload(request);
    return jsonResponse(extraction);
  } catch (error) {
    return handleRouteError(error);
  }
}
