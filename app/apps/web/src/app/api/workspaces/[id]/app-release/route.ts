import {
  HttpError,
  jsonResponse,
  logger,
  requirePermission,
} from "@absensi/auth";

import { handleRouteError } from "@/lib/api";
import {
  APK_FILENAME,
  apkInfo,
  readMobileVersion,
  storeApk,
  writeMobileVersion,
} from "@/lib/mobile-release";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_APK_BYTES = 300 * 1024 * 1024;

function assertWorkspace(tenantId: string | null | undefined, id: string): void {
  // Cross-tenant dan workspace tidak dikenal harus menghasilkan respons identik.
  if (tenantId !== id) {
    throw new HttpError(
      403,
      "WORKSPACE_FORBIDDEN",
      "Workspace tidak tersedia untuk akun ini.",
    );
  }
}

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const { ctx } = await requirePermission(request, "workspace.manage");
    const { id } = await context.params;
    assertWorkspace(ctx.tenantId, id);
    const version = await readMobileVersion();
    const apk = apkInfo();
    return jsonResponse({
      version,
      apk: apk
        ? {
            filename: APK_FILENAME,
            sizeBytes: apk.size,
            updatedAt: apk.updatedAt.toISOString(),
          }
        : null,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const { ctx } = await requirePermission(request, "workspace.manage");
    const { id } = await context.params;
    assertWorkspace(ctx.tenantId, id);

    const form = await request.formData();
    const file = form.get("apk");
    if (!(file instanceof File) || file.size === 0) {
      throw new HttpError(400, "APK_REQUIRED", "Pilih berkas APK rilis.");
    }
    if (!file.name.toLowerCase().endsWith(".apk")) {
      throw new HttpError(400, "INVALID_APK", "Berkas harus berekstensi .apk.");
    }
    if (file.size > MAX_APK_BYTES) {
      throw new HttpError(413, "APK_TOO_LARGE", "Ukuran APK melebihi 300 MB.");
    }

    const latestVersion = String(form.get("latestVersion") ?? "").trim();
    if (!/^\d+\.\d+\.\d+$/.test(latestVersion)) {
      throw new HttpError(
        400,
        "INVALID_VERSION",
        "Format versi harus x.y.z, misalnya 1.2.0.",
      );
    }
    const buildNumber = Number(
      String(form.get("buildNumber") ?? "").trim(),
    );
    if (!Number.isInteger(buildNumber) || buildNumber < 1) {
      throw new HttpError(
        400,
        "INVALID_BUILD_NUMBER",
        "Build number harus bilangan bulat minimal 1.",
      );
    }

    const changelog = String(form.get("changelog") ?? "").slice(0, 4000);
    const forceUpdate = ["1", "true", "on"].includes(
      String(form.get("forceUpdate") ?? "").toLowerCase(),
    );

    await storeApk(new Uint8Array(await file.arrayBuffer()));
    const version = await writeMobileVersion({
      latestVersion,
      buildNumber,
      forceUpdate,
      changelog,
      downloadUrl: "/api/mobile/apk/latest",
    });

    logger.info("mobile release uploaded", {
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      latestVersion,
      buildNumber,
      sizeBytes: file.size,
    });

    return jsonResponse(
      {
        version,
        apk: { filename: APK_FILENAME, sizeBytes: file.size },
      },
      201,
    );
  } catch (error) {
    return handleRouteError(error);
  }
}
