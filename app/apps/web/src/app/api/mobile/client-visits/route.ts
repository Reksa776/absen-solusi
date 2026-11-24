import {
  getClientIp,
  jsonResponse,
  listMyClientVisits,
  recordAdHocClientVisit,
  requirePermission,
} from "@absensi/auth";
import { handleRouteError } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  try {
    const { ctx } = await requirePermission(request, "workspace.read");
    return jsonResponse(
      await listMyClientVisits({
        ctx,
        date: new URL(request.url).searchParams.get("date") ?? undefined,
      }),
    );
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    const { ctx } = await requirePermission(request, "workspace.read");
    const form = await request.formData();
    const file = form.get("photo");
    const photo =
      file instanceof File && file.size > 0
        ? {
            bytes: new Uint8Array(await file.arrayBuffer()),
            contentType: file.type,
            filename: file.name,
          }
        : undefined;
    return jsonResponse(
      await recordAdHocClientVisit({
        ctx,
        clientName: form.get("clientName"),
        latitude: form.get("latitude"),
        longitude: form.get("longitude"),
        accuracyMeters: form.get("accuracy_meters"),
        notes: form.get("notes"),
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
