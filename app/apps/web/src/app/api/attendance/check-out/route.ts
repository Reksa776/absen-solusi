import {
  getClientIp,
  jsonResponse,
  normalizeDeviceIdentity,
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
      deviceIdentity: normalizeDeviceIdentity({
        deviceId: request.headers.get("x-device-id"),
        deviceName: request.headers.get("x-device-name"),
        platform: request.headers.get("x-device-platform"),
        deviceModel: request.headers.get("x-device-model"),
        deviceManufacturer: request.headers.get("x-device-manufacturer"),
      }),
      workMode:
        form.get("work_mode") === "OUT_OF_TOWN"
          ? "OUT_OF_TOWN"
          : form.get("work_mode") === "WFH"
            ? "WFH"
            : "OFFICE",
      outOfTownReason:
        typeof form.get("out_of_town_reason") === "string"
          ? String(form.get("out_of_town_reason"))
          : null,
      notes: typeof form.get("notes") === "string" ? String(form.get("notes")) : null,
      faceVerified: form.get("face_verified") === "true",
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
