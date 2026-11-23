import { randomUUID } from "node:crypto";

import { withTenant, writeAudit, type TenantContext } from "@absensi/database";

import { HttpError } from "./http.js";
import { assertWorkspaceReadClaim } from "./workspaces.js";

export const COMPANY_LEGAL_NAME_MAX_LENGTH = 160;
export const COMPANY_ADDRESS_MAX_LENGTH = 500;

export type CompanyProfileSummary = {
  legalName: string;
  address: string | null;
  taxNumber: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  operatingHours: string | null;
  updatedAt: string | null;
};

function assertManage(ctx: TenantContext): void {
  if (
    !ctx.permissions.includes("workspace.manage") &&
    !ctx.roleKeys.includes("WORKSPACE_OWNER")
  ) {
    throw new HttpError(403, "FORBIDDEN", "Permission tidak mencukupi");
  }
}

function optionalString(
  value: unknown,
  label: string,
  max: number,
): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") {
    throw new HttpError(400, "INVALID_COMPANY_PROFILE", `${label} tidak valid`);
  }
  const text = value.trim();
  if (text === "") return null;
  if (text.length > max) {
    throw new HttpError(400, "INVALID_COMPANY_PROFILE", `${label} maksimal ${max} karakter`);
  }
  return text;
}

export async function getCompanyProfile(input: {
  ctx: TenantContext;
  workspaceId: string;
}): Promise<CompanyProfileSummary> {
  assertWorkspaceReadClaim(input.ctx, input.workspaceId);
  return withTenant(input.ctx, async (db) => {
    const [profile, workspace] = await Promise.all([
      db.companyProfile.findFirst(),
      db.workspace.findFirst({ select: { name: true } }),
    ]);
    return {
      legalName: profile?.legalName ?? workspace?.name ?? "Perusahaan",
      address: profile?.address ?? null,
      taxNumber: profile?.taxNumber ?? null,
      contactEmail: profile?.contactEmail ?? null,
      contactPhone: profile?.contactPhone ?? null,
      operatingHours: profile?.operatingHours ?? null,
      updatedAt: profile?.updatedAt.toISOString() ?? null,
    };
  });
}

export async function updateCompanyProfile(input: {
  ctx: TenantContext;
  workspaceId: string;
  legalName: unknown;
  address?: unknown;
  taxNumber?: unknown;
  contactEmail?: unknown;
  contactPhone?: unknown;
  operatingHours?: unknown;
  ip?: string | null;
  userAgent?: string | null;
}): Promise<CompanyProfileSummary> {
  assertManage(input.ctx);
  assertWorkspaceReadClaim(input.ctx, input.workspaceId);
  const legalName = typeof input.legalName === "string" ? input.legalName.trim() : "";
  if (
    legalName.length < 2 ||
    legalName.length > COMPANY_LEGAL_NAME_MAX_LENGTH
  ) {
    throw new HttpError(
      400,
      "INVALID_COMPANY_PROFILE",
      `Nama resmi perusahaan 2–${COMPANY_LEGAL_NAME_MAX_LENGTH} karakter`,
    );
  }
  const address = optionalString(
    input.address,
    "Alamat",
    COMPANY_ADDRESS_MAX_LENGTH,
  );
  const taxNumber = optionalString(input.taxNumber, "NPWP", 80);
  const contactEmail = optionalString(input.contactEmail, "Email", 255);
  const contactPhone = optionalString(input.contactPhone, "Telepon", 40);
  const operatingHours = optionalString(input.operatingHours, "Jam operasional", 160);
  if (contactEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail)) {
    throw new HttpError(400, "INVALID_COMPANY_PROFILE", "Email perusahaan tidak valid");
  }

  const row = await withTenant(input.ctx, (db) =>
    db.$transaction(async (tx) => {
      const saved = await tx.companyProfile.upsert({
        where: { tenantId: input.ctx.tenantId },
        update: { legalName, address, taxNumber, contactEmail, contactPhone, operatingHours },
        create: {
          id: randomUUID(),
          tenantId: input.ctx.tenantId,
          legalName,
          address,
          taxNumber,
          contactEmail,
          contactPhone,
          operatingHours,
        },
      });
      await writeAudit(
        {
          tenantId: input.ctx.tenantId,
          actorType: "USER",
          actorUserId: input.ctx.userId,
          actorMemberId: input.ctx.memberId,
          action: "company.profile_update",
          resourceType: "company_profile",
          resourceId: saved.id,
          metadata: { legalName, hasTaxNumber: Boolean(taxNumber) },
          ip: input.ip ?? null,
          userAgent: input.userAgent ?? null,
        },
        tx,
      );
      return saved;
    }),
  );
  return {
    legalName: row.legalName,
    address: row.address,
    taxNumber: row.taxNumber,
    contactEmail: row.contactEmail,
    contactPhone: row.contactPhone,
    operatingHours: row.operatingHours,
    updatedAt: row.updatedAt.toISOString(),
  };
}
