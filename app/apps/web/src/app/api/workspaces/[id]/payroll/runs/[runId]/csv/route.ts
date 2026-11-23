import { getPayrollRun, payrollRunToCsv, requirePermission } from "@absensi/auth";
import { handleRouteError } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ id: string; runId: string }> }): Promise<Response> {
  try {
    const { ctx } = await requirePermission(request, "member.manage");
    const { id, runId } = await context.params;
    const run = await getPayrollRun({ ctx, workspaceId: id, runId });
    const { csv } = payrollRunToCsv(run);
    return new Response("\ufeff" + csv, {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="payroll-${run.periodYear}-${String(run.periodMonth).padStart(2, "0")}.csv"`,
        "cache-control": "no-store",
      },
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
