import {
  getClientIp,
  jsonResponse,
  recordAttendance,
  requirePermission,
} from "@absensi/auth";

import { handleRouteError } from "@/lib/api";
import { numberField, photoField } from "@/lib/attendance-form";

export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  try {
    const { ctx } = await requirePermission(request, "workspace.read");
    const form = await request.formData();
    const idempotencyKey =
      request.headers.get("idempotency-key") ??
      (typeof form.get("idempotency_key") === "string"
        ? String(form.get("idempotency_key"))
        : null);
    if (idempotencyKey !== null && !/^[A-Za-z0-9._:-]{8,128}$/.test(idempotencyKey)) {
      return jsonResponse(
        { error: { code: "INVALID_IDEMPOTENCY_KEY", message: "Idempotency-Key tidak valid" } },
        400,
      );
    }
    const result = await recordAttendance({
      ctx,
      type: "CHECK_OUT",
      latitude: numberField(form, "latitude"),
      longitude: numberField(form, "longitude"),
      accuracyMeters: numberField(form, "accuracy_meters"),
      isMockLocation: form.get("is_mock_location") === "true",
      deviceInfo: typeof form.get("device_info") === "string" ? String(form.get("device_info")) : null,
      photo: await photoField(form),
      ip: getClientIp(request),
      userAgent: request.headers.get("user-agent"),
      idempotencyKey,
    });
    return jsonResponse(result, 200);
  } catch (error) {
    return handleRouteError(error);
  }
}
