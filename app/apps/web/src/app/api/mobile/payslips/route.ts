import { jsonResponse, listMyPayslips, requirePermission } from "@absensi/auth";
import { handleRouteError } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  try {
    const { ctx } = await requirePermission(request, "workspace.read");
    return jsonResponse({ payslips: await listMyPayslips({ ctx }) });
  } catch (error) {
    return handleRouteError(error);
  }
}
