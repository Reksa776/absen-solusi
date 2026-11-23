import {
  getClientIp,
  getMyProfilePhoto,
  jsonResponse,
  requirePermission,
  submitProfilePhoto,
} from "@absensi/auth";

import { handleRouteError } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  try {
    const { ctx } = await requirePermission(request, "workspace.read");
    return jsonResponse(await getMyProfilePhoto({ ctx }));
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    const { ctx } = await requirePermission(request, "workspace.read");
    const form = await request.formData();
    const photo = form.get("photo");
    if (!(photo instanceof File)) {
      return jsonResponse(
        { error: { code: "INVALID_PROFILE_PHOTO", message: "Foto wajib diunggah" } },
        400,
      );
    }
    return jsonResponse(
      await submitProfilePhoto({
        ctx,
        workspaceId: ctx.tenantId,
        photo: {
          bytes: new Uint8Array(await photo.arrayBuffer()),
          filename: photo.name,
          contentType: photo.type,
        },
        ip: getClientIp(request),
        userAgent: request.headers.get("user-agent"),
      }),
      201,
    );
  } catch (error) {
    return handleRouteError(error);
  }
}
