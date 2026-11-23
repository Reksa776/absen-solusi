import {
  getClientIp,
  jsonResponse,
  readJsonBody,
  requirePermission,
  submitWorkPermit,
  type PermitProofInput,
} from "@absensi/auth";

import { handleRouteError } from "@/lib/api";

export const dynamic = "force-dynamic";

async function parseSubmit(request: Request): Promise<{
  body: Record<string, unknown>;
  proof?: PermitProofInput;
}> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.includes("multipart/form-data")) {
    return { body: await readJsonBody(request) };
  }
  const form = await request.formData();
  const body: Record<string, unknown> = {
    permitType: form.get("permitType"),
    startDate: form.get("startDate"),
    endDate: form.get("endDate"),
    reason: form.get("reason"),
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

export async function POST(request: Request): Promise<Response> {
  try {
    const { ctx } = await requirePermission(request, "workspace.read");
    const payload = await parseSubmit(request);
    const permit = await submitWorkPermit({
      ctx,
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
