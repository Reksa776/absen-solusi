import { randomUUID } from "node:crypto";

import { isUuid, withTenant, writeAudit, type TenantContext } from "@absensi/database";

import { HttpError } from "./http.js";
import { createInAppNotification } from "./inbox.js";
import { parseReportDay, startOfUtcDay } from "./reports.js";
import { assertWorkspaceReadClaim } from "./workspaces.js";

export const WARNING_LEVELS = ["SP1", "SP2", "SP3"] as const;
export type WarningLevel = (typeof WARNING_LEVELS)[number];

export type WarningLetterSummary = {
  id: string;
  memberId: string;
  memberName: string;
  memberEmail: string;
  level: WarningLevel;
  letterNumber: string;
  issuedAt: string;
  validUntil: string;
  violationReason: string;
  acknowledgedAt: string | null;
  issuedByName: string;
  isActive: boolean;
  createdAt: string;
};

function assertManage(ctx: TenantContext): void {
  if (!ctx.permissions.includes("member.manage")) {
    throw new HttpError(403, "FORBIDDEN", "Permission tidak mencukupi");
  }
}

function assertRead(ctx: TenantContext): void {
  if (
    !ctx.permissions.includes("member.read") &&
    !ctx.permissions.includes("member.manage") &&
    !ctx.roleKeys.includes("WORKSPACE_OWNER") &&
    !ctx.roleKeys.includes("WORKSPACE_ADMIN")
  ) {
    throw new HttpError(403, "FORBIDDEN", "Permission tidak mencukupi");
  }
}

function parseLevel(value: unknown): WarningLevel {
  if (
    typeof value !== "string" ||
    !(WARNING_LEVELS as readonly string[]).includes(value.trim().toUpperCase())
  ) {
    throw new HttpError(400, "INVALID_LEVEL", "Level SP harus SP1, SP2, atau SP3");
  }
  return value.trim().toUpperCase() as WarningLevel;
}

function day(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function isUniqueError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "P2002"
  );
}

function toSummary(
  row: {
    id: string;
    memberId: string;
    level: string;
    letterNumber: string;
    issuedAt: Date;
    validUntil: Date;
    violationReason: string;
    acknowledgedAt: Date | null;
    createdAt: Date;
    member: { user: { name: string; email: string } };
    issuer: { user: { name: string } };
  },
  today: Date,
): WarningLetterSummary {
  return {
    id: row.id,
    memberId: row.memberId,
    memberName: row.member.user.name,
    memberEmail: row.member.user.email,
    level: row.level as WarningLevel,
    letterNumber: row.letterNumber,
    issuedAt: day(row.issuedAt),
    validUntil: day(row.validUntil),
    violationReason: row.violationReason,
    acknowledgedAt: row.acknowledgedAt ? row.acknowledgedAt.toISOString() : null,
    issuedByName: row.issuer.user.name,
    isActive:
      row.issuedAt.getTime() <= today.getTime() &&
      row.validUntil.getTime() >= today.getTime(),
    createdAt: row.createdAt.toISOString(),
  };
}

const INCLUDE = {
  member: { include: { user: { select: { name: true, email: true } } } },
  issuer: { include: { user: { select: { name: true } } } },
} as const;

export async function createWarningLetter(input: {
  ctx: TenantContext;
  workspaceId: string;
  memberId: unknown;
  level: unknown;
  letterNumber: unknown;
  issuedAt: unknown;
  validUntil: unknown;
  violationReason: unknown;
  ip?: string | null;
  userAgent?: string | null;
  now?: Date;
}): Promise<WarningLetterSummary> {
  assertManage(input.ctx);
  assertWorkspaceReadClaim(input.ctx, input.workspaceId);
  if (typeof input.memberId !== "string" || !isUuid(input.memberId)) {
    throw new HttpError(400, "INVALID_MEMBER", "Member tidak valid");
  }
  const level = parseLevel(input.level);
  const letterNumber =
    typeof input.letterNumber === "string" ? input.letterNumber.trim() : "";
  if (letterNumber.length < 1 || letterNumber.length > 80) {
    throw new HttpError(400, "INVALID_LETTER_NUMBER", "Nomor surat wajib diisi maksimal 80 karakter");
  }
  const issuedAt = parseReportDay(
    typeof input.issuedAt === "string" ? input.issuedAt : "",
    "issuedAt",
  );
  const validUntil = parseReportDay(
    typeof input.validUntil === "string" ? input.validUntil : "",
    "validUntil",
  );
  if (validUntil.getTime() < issuedAt.getTime()) {
    throw new HttpError(400, "INVALID_VALIDITY", "Masa berlaku tidak boleh sebelum tanggal terbit");
  }
  const violationReason =
    typeof input.violationReason === "string" ? input.violationReason.trim() : "";
  if (violationReason.length < 10 || violationReason.length > 1000) {
    throw new HttpError(400, "INVALID_REASON", "Alasan pelanggaran 10–1000 karakter");
  }
  const today = startOfUtcDay(input.now ?? new Date());
  const id = randomUUID();

  try {
    const created = await withTenant(input.ctx, (db) =>
      db.$transaction(async (tx) => {
        const member = await tx.workspaceMember.findFirst({
          where: { id: input.memberId as string, status: "ACTIVE" },
          select: { id: true },
        });
        if (!member) {
          throw new HttpError(404, "MEMBER_NOT_FOUND", "Member tidak ditemukan");
        }
        const row = await tx.warningLetter.create({
          data: {
            id,
            tenantId: input.ctx.tenantId,
            memberId: member.id,
            level,
            letterNumber,
            issuedAt,
            validUntil,
            violationReason,
            issuedByMemberId: input.ctx.memberId,
          },
          include: INCLUDE,
        });
        await createInAppNotification(tx, {
          tenantId: input.ctx.tenantId,
          memberId: member.id,
          type: "WARNING_LETTER",
          title: `Surat Peringatan ${level} diterbitkan`,
          body: `Nomor ${letterNumber}. Buka profil untuk membaca dan mengonfirmasi surat peringatan.`,
          linkUrl: `/workspaces/${input.ctx.tenantId}/warning-letters`,
        });
        await writeAudit(
          {
            tenantId: input.ctx.tenantId,
            actorType: "USER",
            actorUserId: input.ctx.userId,
            actorMemberId: input.ctx.memberId,
            action: "warning.issue",
            resourceType: "warning_letter",
            resourceId: id,
            metadata: {
              memberId: member.id,
              level,
              letterNumber,
              issuedAt: day(issuedAt),
              validUntil: day(validUntil),
            },
            ip: input.ip ?? null,
            userAgent: input.userAgent ?? null,
          },
          tx,
        );
        return row;
      }),
    );
    return toSummary(created, today);
  } catch (error) {
    if (isUniqueError(error)) {
      throw new HttpError(409, "LETTER_NUMBER_EXISTS", "Nomor surat sudah digunakan");
    }
    throw error;
  }
}

export async function listWorkspaceWarningLetters(input: {
  ctx: TenantContext;
  workspaceId: string;
  memberId?: string | undefined;
  status?: string | undefined;
  now?: Date;
}): Promise<WarningLetterSummary[]> {
  assertRead(input.ctx);
  assertWorkspaceReadClaim(input.ctx, input.workspaceId);
  if (input.memberId && !isUuid(input.memberId)) {
    throw new HttpError(400, "INVALID_MEMBER", "Member tidak valid");
  }
  const today = startOfUtcDay(input.now ?? new Date());
  const status = input.status?.trim().toUpperCase() || "ALL";
  if (!["ACTIVE", "EXPIRED", "ALL"].includes(status)) {
    throw new HttpError(400, "INVALID_STATUS", "Status SP tidak valid");
  }
  const rows = await withTenant(input.ctx, (db) =>
    db.warningLetter.findMany({
      where: {
        ...(input.memberId ? { memberId: input.memberId } : {}),
        ...(status === "ACTIVE"
          ? { issuedAt: { lte: today }, validUntil: { gte: today } }
          : status === "EXPIRED"
            ? { validUntil: { lt: today } }
            : {}),
      },
      include: INCLUDE,
      orderBy: [{ issuedAt: "desc" }, { createdAt: "desc" }],
      take: 200,
    }),
  );
  return rows.map((row) => toSummary(row, today));
}

export async function listMyWarningLetters(input: {
  ctx: TenantContext;
  now?: Date;
}): Promise<WarningLetterSummary[]> {
  const today = startOfUtcDay(input.now ?? new Date());
  const rows = await withTenant(input.ctx, (db) =>
    db.warningLetter.findMany({
      where: { memberId: input.ctx.memberId },
      include: INCLUDE,
      orderBy: [{ issuedAt: "desc" }, { createdAt: "desc" }],
    }),
  );
  return rows.map((row) => toSummary(row, today));
}

export async function acknowledgeWarningLetter(input: {
  ctx: TenantContext;
  letterId: string;
  ip?: string | null;
  userAgent?: string | null;
  now?: Date;
}): Promise<WarningLetterSummary> {
  if (!isUuid(input.letterId)) {
    throw new HttpError(404, "WARNING_NOT_FOUND", "Surat peringatan tidak ditemukan");
  }
  const now = input.now ?? new Date();
  const today = startOfUtcDay(now);
  const updated = await withTenant(input.ctx, (db) =>
    db.$transaction(async (tx) => {
      const existing = await tx.warningLetter.findFirst({
        where: { id: input.letterId, memberId: input.ctx.memberId },
        include: INCLUDE,
      });
      if (!existing) {
        throw new HttpError(404, "WARNING_NOT_FOUND", "Surat peringatan tidak ditemukan");
      }
      if (existing.acknowledgedAt) {
        return existing;
      }
      const row = await tx.warningLetter.update({
        where: { tenantId_id: { tenantId: input.ctx.tenantId, id: existing.id } },
        data: { acknowledgedAt: now },
        include: INCLUDE,
      });
      await writeAudit(
        {
          tenantId: input.ctx.tenantId,
          actorType: "USER",
          actorUserId: input.ctx.userId,
          actorMemberId: input.ctx.memberId,
          action: "warning.acknowledge",
          resourceType: "warning_letter",
          resourceId: row.id,
          metadata: { level: row.level, letterNumber: row.letterNumber },
          ip: input.ip ?? null,
          userAgent: input.userAgent ?? null,
        },
        tx,
      );
      return row;
    }),
  );
  return toSummary(updated, today);
}
