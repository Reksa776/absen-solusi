import { jsonResponse } from "@absensi/auth";

import { readMobileVersion } from "@/lib/mobile-release";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(): Promise<Response> {
  const version = await readMobileVersion();
  const response = jsonResponse(version);
  response.headers.set("cache-control", "no-store");
  return response;
}
