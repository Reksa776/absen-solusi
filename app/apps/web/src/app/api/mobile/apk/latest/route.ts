import { readFile } from "node:fs/promises";

import { HttpError } from "@absensi/auth";

import { handleRouteError } from "@/lib/api";
import { APK_FILENAME, apkFilePath, apkInfo } from "@/lib/mobile-release";

// Di produksi, server.mjs menangani path ini agar header Content-Length tidak
// dibuang oleh Next; route ini menjadi fallback untuk `next dev`/`next start`.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(): Promise<Response> {
  try {
    const info = apkInfo();
    if (!info) {
      throw new HttpError(
        404,
        "APK_NOT_FOUND",
        "Belum ada berkas APK rilis yang diunggah.",
      );
    }
    // Body berukuran tetap agar Content-Length tidak dibuang oleh server Next.
    const bytes = new Uint8Array(await readFile(apkFilePath()));
    return new Response(bytes, {
      status: 200,
      headers: {
        "content-type": "application/vnd.android.package-archive",
        "content-disposition": `attachment; filename="${APK_FILENAME}"`,
        "content-length": String(info.size),
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
      },
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
