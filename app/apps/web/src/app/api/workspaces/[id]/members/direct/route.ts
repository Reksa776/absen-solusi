import {
  directAddMember,
  getClientIp,
  HttpError,
  jsonResponse,
  readJsonBody,
  requirePermission,
} from "@absensi/auth";

import { assertWorkspaceWriteLimit, handleRouteError } from "@/lib/api";

export const dynamic = "force-dynamic";

function requiredRawString(
  body: Record<string, unknown>,
  field: string,
  maxLength: number,
): string {
  const value = body[field];
  if (typeof value !== "string" || value.length === 0) {
    throw new HttpError(400, "INVALID_INPUT", `Field ${field} wajib diisi`);
  }
  if (value.length > maxLength) {
    throw new HttpError(400, "INVALID_INPUT", `Field ${field} terlalu panjang`);
  }
  return value;
}

function optionalId(
  body: Record<string, unknown>,
  field: string,
): string | null {
  const value = body[field];
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") {
    throw new HttpError(400, "INVALID_INPUT", `Field ${field} tidak valid`);
  }
  return value.trim();
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const { ctx } = await requirePermission(request, "member.invite");
    await assertWorkspaceWriteLimit(ctx.userId, "workspace.member");
    const { id } = await context.params;
    const body = await readJsonBody(request);
    const result = await directAddMember({
      ctx,
      workspaceId: id,
      name: requiredRawString(body, "name", 120),
      email: requiredRawString(body, "email", 255),
      password: requiredRawString(body, "password", 128),
      role: typeof body.role === "string" ? body.role : undefined,
      officeId: optionalId(body, "officeId"),
      shiftId: optionalId(body, "shiftId"),
      ip: getClientIp(request),
      userAgent: request.headers.get("user-agent"),
    });
    return jsonResponse(result, 201);
  } catch (error) {
    return handleRouteError(error);
  }
}
