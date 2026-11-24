import {
  deleteCompanyLogo,
  getClientIp,
  jsonResponse,
  readCompanyLogo,
  requirePermission,
  saveCompanyLogo,
} from "@absensi/auth";

import { handleRouteError } from "@/lib/api";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function imageResponse(file: { bytes: Uint8Array; contentType: string }): Response {
  return new Response(Buffer.from(file.bytes), {
    headers: {
      "content-type": file.contentType,
      "cache-control": "private, max-age=60",
      "x-content-type-options": "nosniff",
    },
  });
}

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const { ctx } = await requirePermission(request, "workspace.read");
    const { id } = await context.params;
    return imageResponse(await readCompanyLogo({ ctx, workspaceId: id }));
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const { ctx } = await requirePermission(request, "workspace.manage");
    const { id } = await context.params;
    const form = await request.formData();
    const file = form.get("logo");
    if (!(file instanceof File)) {
      return jsonResponse(
        {
          error: {
            code: "INVALID_COMPANY_LOGO",
            message: "Pilih berkas logo perusahaan",
          },
        },
        400,
      );
    }
    return jsonResponse(
      await saveCompanyLogo({
        ctx,
        workspaceId: id,
        logo: {
          bytes: new Uint8Array(await file.arrayBuffer()),
          filename: file.name,
          contentType: file.type,
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

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const { ctx } = await requirePermission(request, "workspace.manage");
    const { id } = await context.params;
    await deleteCompanyLogo({
      ctx,
      workspaceId: id,
      ip: getClientIp(request),
      userAgent: request.headers.get("user-agent"),
    });
    return jsonResponse({ deleted: true });
  } catch (error) {
    return handleRouteError(error);
  }
}
