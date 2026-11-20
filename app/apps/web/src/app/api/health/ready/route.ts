import { jsonResponse } from "@absensi/auth";
import { checkReadiness } from "@absensi/database";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const report = await checkReadiness();
  return jsonResponse(report, report.status === "ready" ? 200 : 503);
}
