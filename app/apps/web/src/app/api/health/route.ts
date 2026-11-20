import { jsonResponse } from "@absensi/auth";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  return jsonResponse({ status: "ok", service: "absensi-web", time: new Date().toISOString() });
}
