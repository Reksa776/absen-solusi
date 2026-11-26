import {
  getClientIp,
  jsonResponse,
  readJsonBody,
  requirePermission,
  submitWfh,
  type WorkPlanAttachmentInput,
} from "@absensi/auth";

import { handleRouteError } from "@/lib/api";

export const dynamic = "force-dynamic";

async function parseSubmit(request: Request): Promise<{
  body: Record<string, unknown>;
  attachment?: WorkPlanAttachmentInput;
}> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.includes("multipart/form-data")) {
    return { body: await readJsonBody(request) };
  }
  const form = await request.formData();
  const body: Record<string, unknown> = {
    date: form.get("date"),
    reason: form.get("reason"),
    workMode: form.get("workMode") ?? form.get("work_mode"),
    locationNote: form.get("locationNote") ?? form.get("location_note"),
    workPlanItems: form.get("workPlanItems") ?? form.get("work_plan_items"),
  };
  const file = form.get("plan") ?? form.get("planAttachment");
  if (file instanceof File && file.size > 0) {
    return {
      body,
      attachment: {
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
    const wfh = await submitWfh({
      ctx,
      body: payload.body,
      attachment: payload.attachment,
      ip: getClientIp(request),
      userAgent: request.headers.get("user-agent"),
    });
    return jsonResponse(wfh, 201);
  } catch (error) {
    return handleRouteError(error);
  }
}
