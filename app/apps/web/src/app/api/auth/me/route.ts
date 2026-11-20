import {
  jsonResponse,
  loadWorkspacesForUser,
  requireApiSession,
} from "@absensi/auth";
import { systemDb } from "@absensi/database";

import { handleRouteError } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  try {
    const { session, mode } = await requireApiSession(request);
    // SYSTEM: identitas user untuk sesi yang sudah tervalidasi.
    const user = await systemDb().user.findUnique({ where: { id: session.userId } });
    if (!user) {
      return jsonResponse({ error: { code: "UNAUTHENTICATED", message: "User tidak ditemukan" } }, 401);
    }
    return jsonResponse({
      user: { id: user.id, email: user.email, name: user.name, status: user.status },
      activeTenantId: session.activeTenantId,
      workspaces: await loadWorkspacesForUser(user.id),
      mode,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
