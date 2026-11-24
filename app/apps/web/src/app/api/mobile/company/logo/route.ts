import { jsonResponse, readCompanyLogo, requirePermission } from "@absensi/auth";

import { handleRouteError } from "@/lib/api";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  try {
    const { ctx } = await requirePermission(request, "workspace.read");
    const file = await readCompanyLogo({
      ctx,
      workspaceId: ctx.tenantId,
    });
    return new Response(Buffer.from(file.bytes), {
      headers: {
        "content-type": file.contentType,
        "cache-control": "private, max-age=60",
        "x-content-type-options": "nosniff",
      },
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
