import { getClientIp, jsonResponse, recordClientVisit, requirePermission } from "@absensi/auth";
import { handleRouteError } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function POST(request: Request, context: { params: Promise<{ scheduleId: string }> }): Promise<Response> {
  try {
    const { ctx } = await requirePermission(request, "workspace.read");
    const { scheduleId } = await context.params;
    const form = await request.formData();
    const file = form.get("photo");
    const photo = file instanceof File && file.size > 0
      ? { bytes: new Uint8Array(await file.arrayBuffer()), contentType: file.type, filename: file.name }
      : undefined;
    return jsonResponse(
      await recordClientVisit({
        ctx,
        scheduleId,
        type: String(form.get("type") ?? ""),
        latitude: form.get("latitude"),
        longitude: form.get("longitude"),
        accuracyMeters: form.get("accuracy_meters"),
        notes: form.get("notes") ?? undefined,
        photo,
        ip: getClientIp(request),
        userAgent: request.headers.get("user-agent"),
      }),
      201,
    );
  } catch (error) {
    return handleRouteError(error);
  }
}
