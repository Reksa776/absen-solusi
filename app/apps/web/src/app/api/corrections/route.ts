import { getClientIp, jsonResponse, requirePermission, submitCorrection } from "@absensi/auth";

import { handleRouteError } from "@/lib/api";
import { parseCorrectionSubmit } from "@/lib/correction-form";

export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  try {
    const { ctx } = await requirePermission(request, "workspace.read");
    const payload = await parseCorrectionSubmit(request);
    const result = await submitCorrection({
      ctx,
      attendanceLogId: payload.attendanceLogId,
      requestType: payload.requestType,
      requestedTimestamp: payload.requestedTimestamp,
      reason: payload.reason,
      proof: payload.proof,
      ip: getClientIp(request),
      userAgent: request.headers.get("user-agent"),
    });
    return jsonResponse(result, 201);
  } catch (error) {
    return handleRouteError(error);
  }
}
