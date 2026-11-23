import { readProfilePhoto, requirePermission } from "@absensi/auth";

import { handleRouteError } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string; memberId: string }> },
): Promise<Response> {
  try {
    const { ctx } = await requirePermission(request, "workspace.read");
    const { id, memberId } = await context.params;
    const photo = await readProfilePhoto({ ctx, workspaceId: id, memberId });
    return new Response(Buffer.from(photo.bytes), {
      headers: {
        "content-type": photo.contentType,
        "cache-control": "private, max-age=60",
        "x-content-type-options": "nosniff",
      },
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
