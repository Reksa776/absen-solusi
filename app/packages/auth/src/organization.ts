import { randomUUID } from "node:crypto";

import {
  isUuid,
  withTenant,
  writeAudit,
  type Prisma,
  type TenantContext,
} from "@absensi/database";

import { HttpError } from "./http.js";
import { assertWorkspaceReadClaim } from "./workspaces.js";

export const ORGANIZATION_NAME_MAX_LENGTH = 120;
export const ORGANIZATION_CODE_MAX_LENGTH = 30;
export const ORGANIZATION_DESCRIPTION_MAX_LENGTH = 255;

export type DivisionSummary = {
  id: string;
  name: string;
  code: string | null;
  description: string | null;
  isActive: boolean;
  memberCount: number;
  positionCount: number;
  createdAt: string;
  updatedAt: string;
};

export type PositionSummary = {
  id: string;
  divisionId: string | null;
  divisionName: string | null;
  name: string;
  code: string | null;
  description: string | null;
  isActive: boolean;
  memberCount: number;
  createdAt: string;
  updatedAt: string;
};

export type MemberOrganizationSummary = {
  memberId: string;
  division: { id: string; name: string } | null;
  position: { id: string; name: string; divisionId: string | null } | null;
};

function assertRead(ctx: TenantContext): void {
  if (!ctx.permissions.includes("member.read")) {
    throw new HttpError(403, "FORBIDDEN", "Permission tidak mencukupi");
  }
}

function assertManage(ctx: TenantContext): void {
  if (!ctx.permissions.includes("member.manage")) {
    throw new HttpError(403, "FORBIDDEN", "Permission tidak mencukupi");
  }
}

function parseName(value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new HttpError(400, "INVALID_NAME", "Nama wajib diisi");
  }
  const name = value.trim();
  if (name.length > ORGANIZATION_NAME_MAX_LENGTH) {
    throw new HttpError(400, "INVALID_NAME", "Nama terlalu panjang");
  }
  return name;
}

function optionalText(
  value: unknown,
  field: string,
  maxLength: number,
): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") {
    throw new HttpError(400, "INVALID_INPUT", `Field ${field} tidak valid`);
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  if (trimmed.length > maxLength) {
    throw new HttpError(400, "INVALID_INPUT", `Field ${field} terlalu panjang`);
  }
  return trimmed;
}

function parseActive(value: unknown, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  if (typeof value !== "boolean") {
    throw new HttpError(400, "INVALID_ACTIVE", "Field isActive harus boolean");
  }
  return value;
}

function isUniqueError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "P2002"
  );
}

type DivisionRow = {
  id: string;
  name: string;
  code: string | null;
  description: string | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  _count: { members: number; positions: number };
};

function toDivisionSummary(row: DivisionRow): DivisionSummary {
  return {
    id: row.id,
    name: row.name,
    code: row.code,
    description: row.description,
    isActive: row.isActive,
    memberCount: row._count.members,
    positionCount: row._count.positions,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

type PositionRow = {
  id: string;
  divisionId: string | null;
  name: string;
  code: string | null;
  description: string | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  division: { name: string } | null;
  _count: { members: number };
};

function toPositionSummary(row: PositionRow): PositionSummary {
  return {
    id: row.id,
    divisionId: row.divisionId,
    divisionName: row.division?.name ?? null,
    name: row.name,
    code: row.code,
    description: row.description,
    isActive: row.isActive,
    memberCount: row._count.members,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

async function resolveDivision(
  tx: Prisma.TransactionClient,
  divisionId: string | null,
): Promise<{ id: string; name: string; divisionId: string | null } | null> {
  if (divisionId === null) return null;
  if (!isUuid(divisionId)) {
    throw new HttpError(400, "INVALID_DIVISION", "Divisi tidak valid");
  }
  const division = await tx.division.findFirst({
    where: { id: divisionId },
    select: { id: true, name: true },
  });
  if (!division) {
    throw new HttpError(404, "DIVISION_NOT_FOUND", "Divisi tidak ditemukan");
  }
  return { ...division, divisionId: null };
}

export async function listDivisions(input: {
  ctx: TenantContext;
  workspaceId: string;
}): Promise<DivisionSummary[]> {
  assertRead(input.ctx);
  assertWorkspaceReadClaim(input.ctx, input.workspaceId);
  const rows = await withTenant(input.ctx, (db) =>
    db.division.findMany({
      include: { _count: { select: { members: true, positions: true } } },
      orderBy: [{ isActive: "desc" }, { name: "asc" }],
    }),
  );
  return rows.map(toDivisionSummary);
}

export async function createDivision(input: {
  ctx: TenantContext;
  workspaceId: string;
  body: Record<string, unknown>;
  ip?: string | null;
  userAgent?: string | null;
}): Promise<DivisionSummary> {
  assertManage(input.ctx);
  assertWorkspaceReadClaim(input.ctx, input.workspaceId);
  const name = parseName(input.body.name);
  const code = optionalText(input.body.code, "code", ORGANIZATION_CODE_MAX_LENGTH);
  const description = optionalText(
    input.body.description,
    "description",
    ORGANIZATION_DESCRIPTION_MAX_LENGTH,
  );
  const isActive = parseActive(input.body.isActive, true);
  const id = randomUUID();

  try {
    const created = await withTenant(input.ctx, (db) =>
      db.$transaction(async (tx) => {
        const row = await tx.division.create({
          data: {
            id,
            tenantId: input.ctx.tenantId,
            name,
            code,
            description,
            isActive,
          },
          include: { _count: { select: { members: true, positions: true } } },
        });
        await writeAudit(
          {
            tenantId: input.ctx.tenantId,
            actorType: "USER",
            actorUserId: input.ctx.userId,
            actorMemberId: input.ctx.memberId,
            action: "organization.division_create",
            resourceType: "division",
            resourceId: id,
            metadata: { name, code, isActive },
            ip: input.ip ?? null,
            userAgent: input.userAgent ?? null,
          },
          tx,
        );
        return row;
      }),
    );
    return toDivisionSummary(created);
  } catch (error) {
    if (isUniqueError(error)) {
      throw new HttpError(409, "DIVISION_EXISTS", "Nama divisi sudah dipakai");
    }
    throw error;
  }
}

export async function updateDivision(input: {
  ctx: TenantContext;
  workspaceId: string;
  divisionId: string;
  body: Record<string, unknown>;
  ip?: string | null;
  userAgent?: string | null;
}): Promise<DivisionSummary> {
  assertManage(input.ctx);
  assertWorkspaceReadClaim(input.ctx, input.workspaceId);
  if (!isUuid(input.divisionId)) {
    throw new HttpError(400, "INVALID_DIVISION", "Divisi tidak valid");
  }
  const existing = await withTenant(input.ctx, (db) =>
    db.division.findFirst({ where: { id: input.divisionId } }),
  );
  if (!existing) {
    throw new HttpError(404, "DIVISION_NOT_FOUND", "Divisi tidak ditemukan");
  }

  const name = input.body.name === undefined ? existing.name : parseName(input.body.name);
  const code =
    input.body.code === undefined
      ? existing.code
      : optionalText(input.body.code, "code", ORGANIZATION_CODE_MAX_LENGTH);
  const description =
    input.body.description === undefined
      ? existing.description
      : optionalText(
          input.body.description,
          "description",
          ORGANIZATION_DESCRIPTION_MAX_LENGTH,
        );
  const isActive = parseActive(input.body.isActive, existing.isActive);

  try {
    const updated = await withTenant(input.ctx, (db) =>
      db.$transaction(async (tx) => {
        const row = await tx.division.update({
          where: { tenantId_id: { tenantId: input.ctx.tenantId, id: existing.id } },
          data: { name, code, description, isActive },
          include: { _count: { select: { members: true, positions: true } } },
        });
        await writeAudit(
          {
            tenantId: input.ctx.tenantId,
            actorType: "USER",
            actorUserId: input.ctx.userId,
            actorMemberId: input.ctx.memberId,
            action: "organization.division_update",
            resourceType: "division",
            resourceId: existing.id,
            metadata: { name, code, isActive },
            ip: input.ip ?? null,
            userAgent: input.userAgent ?? null,
          },
          tx,
        );
        return row;
      }),
    );
    return toDivisionSummary(updated);
  } catch (error) {
    if (isUniqueError(error)) {
      throw new HttpError(409, "DIVISION_EXISTS", "Nama divisi sudah dipakai");
    }
    throw error;
  }
}

export async function deleteDivision(input: {
  ctx: TenantContext;
  workspaceId: string;
  divisionId: string;
  ip?: string | null;
  userAgent?: string | null;
}): Promise<DivisionSummary> {
  assertManage(input.ctx);
  assertWorkspaceReadClaim(input.ctx, input.workspaceId);
  const existing = await withTenant(input.ctx, (db) =>
    db.division.findFirst({
      where: { id: input.divisionId },
      include: { _count: { select: { members: true, positions: true } } },
    }),
  );
  if (!existing) {
    throw new HttpError(404, "DIVISION_NOT_FOUND", "Divisi tidak ditemukan");
  }
  if (existing._count.members > 0 || existing._count.positions > 0) {
    throw new HttpError(
      409,
      "DIVISION_IN_USE",
      "Divisi masih dipakai karyawan atau jabatan. Pindahkan dulu sebelum menghapus.",
    );
  }

  await withTenant(input.ctx, (db) =>
    db.$transaction(async (tx) => {
      await tx.division.delete({
        where: { tenantId_id: { tenantId: input.ctx.tenantId, id: existing.id } },
      });
      await writeAudit(
        {
          tenantId: input.ctx.tenantId,
          actorType: "USER",
          actorUserId: input.ctx.userId,
          actorMemberId: input.ctx.memberId,
          action: "organization.division_delete",
          resourceType: "division",
          resourceId: existing.id,
          metadata: { name: existing.name, code: existing.code },
          ip: input.ip ?? null,
          userAgent: input.userAgent ?? null,
        },
        tx,
      );
    }),
  );
  return toDivisionSummary(existing);
}

export async function listPositions(input: {
  ctx: TenantContext;
  workspaceId: string;
}): Promise<PositionSummary[]> {
  assertRead(input.ctx);
  assertWorkspaceReadClaim(input.ctx, input.workspaceId);
  const rows = await withTenant(input.ctx, (db) =>
    db.position.findMany({
      include: {
        division: { select: { name: true } },
        _count: { select: { members: true } },
      },
      orderBy: [{ isActive: "desc" }, { name: "asc" }],
    }),
  );
  return rows.map(toPositionSummary);
}

export async function createPosition(input: {
  ctx: TenantContext;
  workspaceId: string;
  body: Record<string, unknown>;
  ip?: string | null;
  userAgent?: string | null;
}): Promise<PositionSummary> {
  assertManage(input.ctx);
  assertWorkspaceReadClaim(input.ctx, input.workspaceId);
  const name = parseName(input.body.name);
  const code = optionalText(input.body.code, "code", ORGANIZATION_CODE_MAX_LENGTH);
  const description = optionalText(
    input.body.description,
    "description",
    ORGANIZATION_DESCRIPTION_MAX_LENGTH,
  );
  const isActive = parseActive(input.body.isActive, true);
  const rawDivision = input.body.divisionId;
  if (rawDivision !== undefined && rawDivision !== null && typeof rawDivision !== "string") {
    throw new HttpError(400, "INVALID_DIVISION", "Divisi tidak valid");
  }
  const divisionId =
    typeof rawDivision === "string" && rawDivision.trim() !== ""
      ? rawDivision.trim()
      : null;
  const id = randomUUID();

  try {
    const created = await withTenant(input.ctx, (db) =>
      db.$transaction(async (tx) => {
        const division = await resolveDivision(tx, divisionId);
        const row = await tx.position.create({
          data: {
            id,
            tenantId: input.ctx.tenantId,
            divisionId: division?.id ?? null,
            name,
            code,
            description,
            isActive,
          },
          include: {
            division: { select: { name: true } },
            _count: { select: { members: true } },
          },
        });
        await writeAudit(
          {
            tenantId: input.ctx.tenantId,
            actorType: "USER",
            actorUserId: input.ctx.userId,
            actorMemberId: input.ctx.memberId,
            action: "organization.position_create",
            resourceType: "position",
            resourceId: id,
            metadata: { name, code, divisionId: row.divisionId, isActive },
            ip: input.ip ?? null,
            userAgent: input.userAgent ?? null,
          },
          tx,
        );
        return row;
      }),
    );
    return toPositionSummary(created);
  } catch (error) {
    if (isUniqueError(error)) {
      throw new HttpError(409, "POSITION_EXISTS", "Nama jabatan sudah dipakai");
    }
    throw error;
  }
}

export async function updatePosition(input: {
  ctx: TenantContext;
  workspaceId: string;
  positionId: string;
  body: Record<string, unknown>;
  ip?: string | null;
  userAgent?: string | null;
}): Promise<PositionSummary> {
  assertManage(input.ctx);
  assertWorkspaceReadClaim(input.ctx, input.workspaceId);
  if (!isUuid(input.positionId)) {
    throw new HttpError(400, "INVALID_POSITION", "Jabatan tidak valid");
  }
  const existing = await withTenant(input.ctx, (db) =>
    db.position.findFirst({ where: { id: input.positionId } }),
  );
  if (!existing) {
    throw new HttpError(404, "POSITION_NOT_FOUND", "Jabatan tidak ditemukan");
  }

  const name = input.body.name === undefined ? existing.name : parseName(input.body.name);
  const code =
    input.body.code === undefined
      ? existing.code
      : optionalText(input.body.code, "code", ORGANIZATION_CODE_MAX_LENGTH);
  const description =
    input.body.description === undefined
      ? existing.description
      : optionalText(
          input.body.description,
          "description",
          ORGANIZATION_DESCRIPTION_MAX_LENGTH,
        );
  const isActive = parseActive(input.body.isActive, existing.isActive);
  const rawDivision = input.body.divisionId;
  if (rawDivision !== undefined && rawDivision !== null && typeof rawDivision !== "string") {
    throw new HttpError(400, "INVALID_DIVISION", "Divisi tidak valid");
  }
  const divisionId =
    input.body.divisionId === undefined
      ? existing.divisionId
      : typeof rawDivision === "string" && rawDivision.trim() !== ""
        ? rawDivision.trim()
        : null;

  try {
    const updated = await withTenant(input.ctx, (db) =>
      db.$transaction(async (tx) => {
        const division = await resolveDivision(tx, divisionId);
        const row = await tx.position.update({
          where: { tenantId_id: { tenantId: input.ctx.tenantId, id: existing.id } },
          data: {
            name,
            code,
            description,
            isActive,
            divisionId: division?.id ?? null,
          },
          include: {
            division: { select: { name: true } },
            _count: { select: { members: true } },
          },
        });
        await writeAudit(
          {
            tenantId: input.ctx.tenantId,
            actorType: "USER",
            actorUserId: input.ctx.userId,
            actorMemberId: input.ctx.memberId,
            action: "organization.position_update",
            resourceType: "position",
            resourceId: existing.id,
            metadata: { name, code, divisionId: row.divisionId, isActive },
            ip: input.ip ?? null,
            userAgent: input.userAgent ?? null,
          },
          tx,
        );
        return row;
      }),
    );
    return toPositionSummary(updated);
  } catch (error) {
    if (isUniqueError(error)) {
      throw new HttpError(409, "POSITION_EXISTS", "Nama jabatan sudah dipakai");
    }
    throw error;
  }
}

export async function deletePosition(input: {
  ctx: TenantContext;
  workspaceId: string;
  positionId: string;
  ip?: string | null;
  userAgent?: string | null;
}): Promise<PositionSummary> {
  assertManage(input.ctx);
  assertWorkspaceReadClaim(input.ctx, input.workspaceId);
  const existing = await withTenant(input.ctx, (db) =>
    db.position.findFirst({
      where: { id: input.positionId },
      include: {
        division: { select: { name: true } },
        _count: { select: { members: true } },
      },
    }),
  );
  if (!existing) {
    throw new HttpError(404, "POSITION_NOT_FOUND", "Jabatan tidak ditemukan");
  }
  if (existing._count.members > 0) {
    throw new HttpError(
      409,
      "POSITION_IN_USE",
      "Jabatan masih dipakai karyawan. Pindahkan dulu sebelum menghapus.",
    );
  }

  await withTenant(input.ctx, (db) =>
    db.$transaction(async (tx) => {
      await tx.position.delete({
        where: { tenantId_id: { tenantId: input.ctx.tenantId, id: existing.id } },
      });
      await writeAudit(
        {
          tenantId: input.ctx.tenantId,
          actorType: "USER",
          actorUserId: input.ctx.userId,
          actorMemberId: input.ctx.memberId,
          action: "organization.position_delete",
          resourceType: "position",
          resourceId: existing.id,
          metadata: { name: existing.name, code: existing.code },
          ip: input.ip ?? null,
          userAgent: input.userAgent ?? null,
        },
        tx,
      );
    }),
  );
  return toPositionSummary(existing);
}

/**
 * Penugasan divisi/jabatan. Jabatan yang terikat divisi menentukan divisinya,
 * sehingga UI cukup mengirim positionId saat jabatan diubah.
 */
export async function assignMemberOrganization(input: {
  ctx: TenantContext;
  workspaceId: string;
  memberId: string;
  divisionId: string | null;
  positionId: string | null;
  ip?: string | null;
  userAgent?: string | null;
}): Promise<MemberOrganizationSummary> {
  assertManage(input.ctx);
  assertWorkspaceReadClaim(input.ctx, input.workspaceId);
  if (!isUuid(input.memberId)) {
    throw new HttpError(400, "INVALID_MEMBER", "Member tidak valid");
  }

  return withTenant(input.ctx, (db) =>
    db.$transaction(async (tx) => {
      const member = await tx.workspaceMember.findFirst({
        where: { id: input.memberId, status: "ACTIVE" },
        select: { id: true },
      });
      if (!member) {
        throw new HttpError(404, "MEMBER_NOT_FOUND", "Member tidak ditemukan");
      }

      const position =
        input.positionId === null
          ? null
          : await tx.position.findFirst({
              where: { id: input.positionId },
              select: { id: true, name: true, divisionId: true },
            });
      if (input.positionId !== null && !position) {
        throw new HttpError(404, "POSITION_NOT_FOUND", "Jabatan tidak ditemukan");
      }

      const division =
        input.divisionId === null
          ? null
          : await tx.division.findFirst({
              where: { id: input.divisionId },
              select: { id: true, name: true },
            });
      if (input.divisionId !== null && !division) {
        throw new HttpError(404, "DIVISION_NOT_FOUND", "Divisi tidak ditemukan");
      }

      const effectiveDivisionId = position?.divisionId ?? division?.id ?? null;
      const effectiveDivision =
        effectiveDivisionId === division?.id
          ? division
          : effectiveDivisionId === null
            ? null
            : await tx.division.findFirst({
                where: { id: effectiveDivisionId },
                select: { id: true, name: true },
              });

      await tx.workspaceMember.update({
        where: { tenantId_id: { tenantId: input.ctx.tenantId, id: member.id } },
        data: { divisionId: effectiveDivisionId, positionId: position?.id ?? null },
      });
      await writeAudit(
        {
          tenantId: input.ctx.tenantId,
          actorType: "USER",
          actorUserId: input.ctx.userId,
          actorMemberId: input.ctx.memberId,
          action: "organization.member_assign",
          resourceType: "member",
          resourceId: member.id,
          metadata: {
            divisionId: effectiveDivisionId,
            positionId: position?.id ?? null,
          },
          ip: input.ip ?? null,
          userAgent: input.userAgent ?? null,
        },
        tx,
      );

      return {
        memberId: member.id,
        division: effectiveDivision,
        position,
      };
    }),
  );
}

export async function getMyOrganization(input: {
  ctx: TenantContext;
}): Promise<MemberOrganizationSummary> {
  if (!input.ctx.permissions.includes("workspace.read")) {
    throw new HttpError(403, "FORBIDDEN", "Permission tidak mencukupi");
  }
  const member = await withTenant(input.ctx, (db) =>
    db.workspaceMember.findFirst({
      where: { id: input.ctx.memberId },
      select: {
        id: true,
        division: { select: { id: true, name: true } },
        position: { select: { id: true, name: true, divisionId: true } },
      },
    }),
  );
  if (!member) {
    throw new HttpError(404, "MEMBER_NOT_FOUND", "Member tidak ditemukan");
  }
  return {
    memberId: member.id,
    division: member.division,
    position: member.position,
  };
}
