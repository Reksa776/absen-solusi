import { readClientVisitPhoto, requirePermission } from "@absensi/auth";
import { handleRouteError } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ logId: string }> }): Promise<Response> {
  try {
    const { ctx } = await requirePermission(request, "workspace.read");
    const { logId } = await context.params;
    const file = await readClientVisitPhoto({ ctx, logId });
    const body = file.bytes.buffer.slice(file.bytes.byteOffset, file.bytes.byteOffset + file.bytes.byteLength) as ArrayBuffer;
    return new Response(body, {
      headers: { "content-type": file.contentType, "cache-control": "private, no-store", "x-content-type-options": "nosniff" },
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
