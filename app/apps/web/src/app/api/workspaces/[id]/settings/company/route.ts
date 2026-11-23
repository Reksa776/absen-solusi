import { getClientIp, getCompanyProfile, jsonResponse, readJsonBody, requirePermission, updateCompanyProfile } from "@absensi/auth";
import { handleRouteError } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const { ctx } = await requirePermission(request, "workspace.read");
    const { id } = await context.params;
    return jsonResponse(await getCompanyProfile({ ctx, workspaceId: id }));
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const { ctx } = await requirePermission(request, "workspace.manage");
    const { id } = await context.params;
    const body = await readJsonBody(request);
    return jsonResponse(
      await updateCompanyProfile({
        ctx,
        workspaceId: id,
        legalName: body.legalName,
        address: body.address,
        taxNumber: body.taxNumber,
        contactEmail: body.contactEmail,
        contactPhone: body.contactPhone,
        operatingHours: body.operatingHours,
        ip: getClientIp(request),
        userAgent: request.headers.get("user-agent"),
      }),
    );
  } catch (error) {
    return handleRouteError(error);
  }
}
