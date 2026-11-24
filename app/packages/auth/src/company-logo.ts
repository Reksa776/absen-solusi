import { randomUUID } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";

import { withTenant, writeAudit, type TenantContext } from "@absensi/database";

import { HttpError } from "./http.js";
import { profilePhotoContentType } from "./profile-photo.js";
import { assertWorkspaceReadClaim } from "./workspaces.js";

export const MAX_COMPANY_LOGO_BYTES = 2 * 1024 * 1024;

const EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};
const STORAGE_KEY_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp)$/;

export type CompanyLogoInput = {
  bytes: Uint8Array;
  filename: string;
  contentType: string;
};

export type CompanyLogoFile = {
  bytes: Uint8Array;
  contentType: string;
  filename: string;
};

export type CompanyLogoSummary = {
  logoUrl: string;
  updatedAt: string;
};

export function companyLogoDirectory(env: NodeJS.ProcessEnv = process.env): string {
  return env.COMPANY_LOGO_DIR ?? join(process.cwd(), "storage", "company-logos");
}

function assertManage(ctx: TenantContext): void {
  if (
    !ctx.permissions.includes("workspace.manage") &&
    !ctx.roleKeys.includes("WORKSPACE_OWNER") &&
    !ctx.roleKeys.includes("WORKSPACE_ADMIN")
  ) {
    throw new HttpError(403, "FORBIDDEN", "Permission tidak mencukupi");
  }
}

function logoUrlFor(workspaceId: string): string {
  return `/api/workspaces/${workspaceId}/settings/company/logo`;
}

function validateKey(key: string | null): string | null {
  if (!key) return null;
  const name = basename(key);
  return STORAGE_KEY_PATTERN.test(name) ? name : null;
}

export async function saveCompanyLogo(input: {
  ctx: TenantContext;
  workspaceId: string;
  logo: CompanyLogoInput;
  ip?: string | null;
  userAgent?: string | null;
}): Promise<CompanyLogoSummary> {
  assertManage(input.ctx);
  assertWorkspaceReadClaim(input.ctx, input.workspaceId);
  if (
    input.logo.bytes.byteLength === 0 ||
    input.logo.bytes.byteLength > MAX_COMPANY_LOGO_BYTES
  ) {
    throw new HttpError(
      400,
      "INVALID_COMPANY_LOGO",
      "Logo wajib berupa gambar maksimal 2 MB",
    );
  }
  const contentType = profilePhotoContentType(input.logo.bytes);
  if (!contentType) {
    throw new HttpError(
      400,
      "INVALID_COMPANY_LOGO",
      "Logo harus berupa PNG, JPG, atau WebP",
    );
  }
  const extension = EXTENSIONS[contentType];
  const storageKey = `${input.ctx.tenantId}.${extension}`;
  const directory = resolve(companyLogoDirectory());
  const path = resolve(join(directory, storageKey));
  if (!path.startsWith(`${directory}/`)) {
    throw new HttpError(400, "INVALID_COMPANY_LOGO", "Nama berkas logo tidak valid");
  }

  await mkdir(directory, { recursive: true });
  await writeFile(path, input.logo.bytes, { flag: "w" });

  try {
    const saved = await withTenant(input.ctx, (db) =>
      db.$transaction(async (tx) => {
        const workspace = await tx.workspace.findFirstOrThrow({
          where: { id: input.workspaceId },
          select: { name: true },
        });
        const profile = await tx.companyProfile.findFirst({
          where: { tenantId: input.ctx.tenantId },
          select: { logoStorageKey: true },
        });
        const row = await tx.companyProfile.upsert({
          where: { tenantId: input.ctx.tenantId },
          update: {
            logoUrl: logoUrlFor(input.workspaceId),
            logoStorageKey: storageKey,
          },
          create: {
            id: randomUUID(),
            tenantId: input.ctx.tenantId,
            legalName: workspace.name,
            logoUrl: logoUrlFor(input.workspaceId),
            logoStorageKey: storageKey,
          },
        });
        await writeAudit(
          {
            tenantId: input.ctx.tenantId,
            actorType: "USER",
            actorUserId: input.ctx.userId,
            actorMemberId: input.ctx.memberId,
            action: "company.logo_upload",
            resourceType: "company_profile",
            resourceId: row.id,
            metadata: {
              contentType,
              size: input.logo.bytes.byteLength,
              replaced: Boolean(profile?.logoStorageKey),
            },
            ip: input.ip ?? null,
            userAgent: input.userAgent ?? null,
          },
          tx,
        );
        return { row, previousKey: profile?.logoStorageKey ?? null };
      }),
    );

    const previous = validateKey(saved.previousKey);
    if (previous && previous !== storageKey) {
      await unlink(join(directory, previous)).catch(() => undefined);
    }
    return {
      logoUrl: saved.row.logoUrl ?? logoUrlFor(input.workspaceId),
      updatedAt: saved.row.updatedAt.toISOString(),
    };
  } catch (error) {
    await unlink(path).catch(() => undefined);
    throw error;
  }
}

export async function deleteCompanyLogo(input: {
  ctx: TenantContext;
  workspaceId: string;
  ip?: string | null;
  userAgent?: string | null;
}): Promise<void> {
  assertManage(input.ctx);
  assertWorkspaceReadClaim(input.ctx, input.workspaceId);
  const previousKey = await withTenant(input.ctx, (db) =>
    db.$transaction(async (tx) => {
      const profile = await tx.companyProfile.findFirst({
        where: { tenantId: input.ctx.tenantId },
      });
      if (!profile?.logoStorageKey && !profile?.logoUrl) return null;
      const row = await tx.companyProfile.update({
        where: { tenantId: input.ctx.tenantId },
        data: { logoUrl: null, logoStorageKey: null },
      });
      await writeAudit(
        {
          tenantId: input.ctx.tenantId,
          actorType: "USER",
          actorUserId: input.ctx.userId,
          actorMemberId: input.ctx.memberId,
          action: "company.logo_delete",
          resourceType: "company_profile",
          resourceId: row.id,
          metadata: { hadLogo: true },
          ip: input.ip ?? null,
          userAgent: input.userAgent ?? null,
        },
        tx,
      );
      return profile.logoStorageKey;
    }),
  );
  const key = validateKey(previousKey);
  if (key) {
    await unlink(join(resolve(companyLogoDirectory()), key)).catch(
      () => undefined,
    );
  }
}

export async function readCompanyLogo(input: {
  ctx: TenantContext;
  workspaceId: string;
}): Promise<CompanyLogoFile> {
  assertWorkspaceReadClaim(input.ctx, input.workspaceId);
  const profile = await withTenant(input.ctx, (db) =>
    db.companyProfile.findFirst({
      where: { tenantId: input.ctx.tenantId },
      select: { logoStorageKey: true },
    }),
  );
  const key = validateKey(profile?.logoStorageKey ?? null);
  if (!key || !key.startsWith(`${input.ctx.tenantId}.`)) {
    throw new HttpError(404, "COMPANY_LOGO_NOT_FOUND", "Logo perusahaan belum tersedia");
  }
  const directory = resolve(companyLogoDirectory());
  const path = resolve(join(directory, key));
  if (!path.startsWith(`${directory}/`)) {
    throw new HttpError(404, "COMPANY_LOGO_NOT_FOUND", "Logo perusahaan belum tersedia");
  }
  try {
    const bytes = await readFile(path);
    const contentType = profilePhotoContentType(bytes);
    if (!contentType) {
      throw new HttpError(
        404,
        "COMPANY_LOGO_NOT_FOUND",
        "Logo perusahaan tidak valid",
      );
    }
    return { bytes, contentType, filename: key };
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(404, "COMPANY_LOGO_NOT_FOUND", "Logo perusahaan belum tersedia");
  }
}
