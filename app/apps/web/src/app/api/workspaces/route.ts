import {
  createWorkspace,
  getClientIp,
  jsonResponse,
  loadWorkspacesForUser,
  readJsonBody,
  requireApiSession,
  requireString,
} from "@absensi/auth";

import { assertWorkspaceWriteLimit, handleRouteError } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  try {
    const { session } = await requireApiSession(request);
    return jsonResponse({ workspaces: await loadWorkspacesForUser(session.userId) });
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    const { session } = await requireApiSession(request);
    await assertWorkspaceWriteLimit(session.userId, "workspace.create");
    const body = await readJsonBody(request);
    const result = await createWorkspace({
      userId: session.userId,
      name: requireString(body, "name", 120),
      ip: getClientIp(request),
      userAgent: request.headers.get("user-agent"),
    });
    return jsonResponse(result, 201);
  } catch (error) {
    return handleRouteError(error);
  }
}
