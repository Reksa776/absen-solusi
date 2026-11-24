import {
  createWorkPermitByAdmin,
  getClientIp,
  jsonResponse,
  listWorkspaceWorkPermits,
  readJsonBody,
  requirePermission,
  type PermitProofInput,
} from "@absensi/auth";

import { handleRouteError } from "@/lib/api";

export const dynamic = "force-dynamic";

async function parseCreate(request: Request): Promise<{
  body: Record<string, unknown>;
  proof?: PermitProofInput;
}> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.includes("multipart/form-data")) {
    return { body: await readJsonBody(request) };
  }
  const form = await request.formData();
  const body: Record<string, unknown> = {
    memberId: form.get("memberId"),
    permitType: form.get("permitType"),
    startDate: form.get("startDate"),
    endDate: form.get("endDate"),
    reason: form.get("reason"),
    status: form.get("status"),
  };
  const file = form.get("proof");
  if (file instanceof File && file.size > 0) {
    return {
      body,
      proof: {
        bytes: new Uint8Array(await file.arrayBuffer()),
        contentType: file.type,
        filename: file.name,
      },
    };
  }
  return { body };
}

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const { ctx } = await requirePermission(request, "correction.review");
    const { id } = await context.params;
    const url = new URL(request.url);
    return jsonResponse({
      permits: await listWorkspaceWorkPermits({
        ctx,
        workspaceId: id,
        status: url.searchParams.get("status") ?? undefined,
        memberId: url.searchParams.get("memberId") ?? undefined,
      }),
    });
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const { ctx } = await requirePermission(request, "correction.review");
    const { id } = await context.params;
    const payload = await parseCreate(request);
    const permit = await createWorkPermitByAdmin({
      ctx,
      workspaceId: id,
      body: payload.body,
      proof: payload.proof,
      ip: getClientIp(request),
      userAgent: request.headers.get("user-agent"),
    });
    return jsonResponse(permit, 201);
  } catch (error) {
    return handleRouteError(error);
  }
}
