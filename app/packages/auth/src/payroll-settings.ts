import { randomUUID } from "node:crypto";

import { isUuid, withTenant, writeAudit, type TenantContext } from "@absensi/database";

import { HttpError } from "./http.js";
import { assertWorkspaceReadClaim } from "./workspaces.js";

export type PayrollSettingSummary = {
  currency: string;
  baseSalary: number;
  attendanceAllowance: number;
  transportAllowance: number;
  mealAllowance: number;
  overtimeHourlyRate: number;
  lateDeductionPerMinute: number;
  lateDeductionPerIncident: number;
  sp1Deduction: number;
  sp2Deduction: number;
  sp3Deduction: number;
};

export type MemberCompensationSummary = {
  id: string | null;
  memberId: string;
  memberName: string;
  memberEmail: string;
  divisionName: string | null;
  baseSalary: number | null;
  attendanceAllowance: number | null;
  transportAllowance: number | null;
  mealAllowance: number | null;
  overtimeHourlyRate: number | null;
  effectiveFrom: string | null;
  notes: string | null;
};

const MONEY_MAX = 2_000_000_000;

function assertManage(ctx: TenantContext): void {
  if (
    !ctx.permissions.includes("member.manage") &&
    !ctx.roleKeys.includes("WORKSPACE_OWNER") &&
    !ctx.roleKeys.includes("WORKSPACE_ADMIN")
  ) {
    throw new HttpError(403, "FORBIDDEN", "Permission tidak mencukupi");
  }
}

function money(value: unknown, label: string, fallback?: number): number {
  const raw = value === undefined || value === null ? fallback : Number(value);
  if (
    raw === undefined ||
    !Number.isInteger(raw) ||
    raw < 0 ||
    raw > MONEY_MAX
  ) {
    throw new HttpError(400, "INVALID_AMOUNT", `${label} harus bilangan bulat 0–${MONEY_MAX}`);
  }
  return raw;
}

function nullableMoney(value: unknown, label: string): number | null {
  if (value === undefined || value === null || value === "") return null;
  return money(value, label);
}

export async function getPayrollSettings(input: {
  ctx: TenantContext;
  workspaceId: string;
}): Promise<PayrollSettingSummary> {
  assertManage(input.ctx);
  assertWorkspaceReadClaim(input.ctx, input.workspaceId);
  return withTenant(input.ctx, async (db) => {
    const row = await db.payrollSetting.findFirst();
    return {
      currency: row?.currency ?? "IDR",
      baseSalary: row?.baseSalary ?? 0,
      attendanceAllowance: row?.attendanceAllowance ?? 0,
      transportAllowance: row?.transportAllowance ?? 0,
      mealAllowance: row?.mealAllowance ?? 0,
      overtimeHourlyRate: row?.overtimeHourlyRate ?? 0,
      lateDeductionPerMinute: row?.lateDeductionPerMinute ?? 0,
      lateDeductionPerIncident: row?.lateDeductionPerIncident ?? 0,
      sp1Deduction: row?.sp1Deduction ?? 0,
      sp2Deduction: row?.sp2Deduction ?? 0,
      sp3Deduction: row?.sp3Deduction ?? 0,
    };
  });
}

export async function updatePayrollSettings(input: {
  ctx: TenantContext;
  workspaceId: string;
  body: Record<string, unknown>;
  ip?: string | null;
  userAgent?: string | null;
}): Promise<PayrollSettingSummary> {
  assertManage(input.ctx);
  assertWorkspaceReadClaim(input.ctx, input.workspaceId);
  const current = await getPayrollSettings(input);
  const next: PayrollSettingSummary = {
    currency: "IDR",
    baseSalary: money(input.body.baseSalary, "Gaji pokok", current.baseSalary),
    attendanceAllowance: money(input.body.attendanceAllowance, "Tunjangan hadir", current.attendanceAllowance),
    transportAllowance: money(input.body.transportAllowance, "Tunjangan transport", current.transportAllowance),
    mealAllowance: money(input.body.mealAllowance, "Tunjangan makan", current.mealAllowance),
    overtimeHourlyRate: money(input.body.overtimeHourlyRate, "Tarif lembur", current.overtimeHourlyRate),
    lateDeductionPerMinute: money(input.body.lateDeductionPerMinute, "Potongan telat per menit", current.lateDeductionPerMinute),
    lateDeductionPerIncident: money(input.body.lateDeductionPerIncident, "Potongan telat per kejadian", current.lateDeductionPerIncident),
    sp1Deduction: money(input.body.sp1Deduction, "Potongan SP1", current.sp1Deduction),
    sp2Deduction: money(input.body.sp2Deduction, "Potongan SP2", current.sp2Deduction),
    sp3Deduction: money(input.body.sp3Deduction, "Potongan SP3", current.sp3Deduction),
  };
  const row = await withTenant(input.ctx, (db) =>
    db.$transaction(async (tx) => {
      const saved = await tx.payrollSetting.upsert({
        where: { tenantId: input.ctx.tenantId },
        update: next,
        create: { id: randomUUID(), tenantId: input.ctx.tenantId, ...next },
      });
      await writeAudit(
        {
          tenantId: input.ctx.tenantId,
          actorType: "USER",
          actorUserId: input.ctx.userId,
          actorMemberId: input.ctx.memberId,
          action: "payroll.settings_update",
          resourceType: "payroll_setting",
          resourceId: saved.id,
          metadata: { baseSalary: next.baseSalary, overtimeHourlyRate: next.overtimeHourlyRate },
          ip: input.ip ?? null,
          userAgent: input.userAgent ?? null,
        },
        tx,
      );
      return saved;
    }),
  );
  return {
    currency: row.currency,
    baseSalary: row.baseSalary,
    attendanceAllowance: row.attendanceAllowance,
    transportAllowance: row.transportAllowance,
    mealAllowance: row.mealAllowance,
    overtimeHourlyRate: row.overtimeHourlyRate,
    lateDeductionPerMinute: row.lateDeductionPerMinute,
    lateDeductionPerIncident: row.lateDeductionPerIncident,
    sp1Deduction: row.sp1Deduction,
    sp2Deduction: row.sp2Deduction,
    sp3Deduction: row.sp3Deduction,
  };
}

export async function listMemberCompensations(input: {
  ctx: TenantContext;
  workspaceId: string;
}): Promise<MemberCompensationSummary[]> {
  assertManage(input.ctx);
  assertWorkspaceReadClaim(input.ctx, input.workspaceId);
  return withTenant(input.ctx, async (db) => {
    const [members, rows] = await Promise.all([
      db.workspaceMember.findMany({
        where: { status: "ACTIVE" },
        include: {
          user: { select: { name: true, email: true } },
          division: { select: { name: true } },
        },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      }),
      db.memberCompensation.findMany(),
    ]);
    const byMember = new Map(rows.map((row) => [row.memberId, row]));
    return members.map((member) => {
      const row = byMember.get(member.id);
      return {
        id: row?.id ?? null,
        memberId: member.id,
        memberName: member.user.name,
        memberEmail: member.user.email,
        divisionName: member.division?.name ?? null,
        baseSalary: row?.baseSalary ?? null,
        attendanceAllowance: row?.attendanceAllowance ?? null,
        transportAllowance: row?.transportAllowance ?? null,
        mealAllowance: row?.mealAllowance ?? null,
        overtimeHourlyRate: row?.overtimeHourlyRate ?? null,
        effectiveFrom: row?.effectiveFrom ? row.effectiveFrom.toISOString().slice(0, 10) : null,
        notes: row?.notes ?? null,
      };
    });
  });
}

export async function upsertMemberCompensation(input: {
  ctx: TenantContext;
  workspaceId: string;
  memberId: string;
  body: Record<string, unknown>;
  ip?: string | null;
  userAgent?: string | null;
}): Promise<MemberCompensationSummary> {
  assertManage(input.ctx);
  assertWorkspaceReadClaim(input.ctx, input.workspaceId);
  if (!isUuid(input.memberId)) {
    throw new HttpError(404, "MEMBER_NOT_FOUND", "Karyawan tidak ditemukan");
  }
  const notes =
    typeof input.body.notes === "string" && input.body.notes.trim() !== ""
      ? input.body.notes.trim()
      : null;
  if (notes && notes.length > 500) {
    throw new HttpError(400, "INVALID_NOTES", "Catatan maksimal 500 karakter");
  }
  const effectiveFrom =
    typeof input.body.effectiveFrom === "string" && input.body.effectiveFrom !== ""
      ? new Date(`${input.body.effectiveFrom}T00:00:00.000Z`)
      : null;
  if (effectiveFrom && Number.isNaN(effectiveFrom.getTime())) {
    throw new HttpError(400, "INVALID_DATE", "Tanggal efektif tidak valid");
  }
  const data = {
    baseSalary: nullableMoney(input.body.baseSalary, "Gaji pokok"),
    attendanceAllowance: nullableMoney(input.body.attendanceAllowance, "Tunjangan hadir"),
    transportAllowance: nullableMoney(input.body.transportAllowance, "Tunjangan transport"),
    mealAllowance: nullableMoney(input.body.mealAllowance, "Tunjangan makan"),
    overtimeHourlyRate: nullableMoney(input.body.overtimeHourlyRate, "Tarif lembur"),
    effectiveFrom,
    notes,
  };
  return withTenant(input.ctx, async (db) => {
    const member = await db.workspaceMember.findFirst({
      where: { id: input.memberId },
      include: {
        user: { select: { name: true, email: true } },
        division: { select: { name: true } },
      },
    });
    if (!member) throw new HttpError(404, "MEMBER_NOT_FOUND", "Karyawan tidak ditemukan");
    const row = await db.memberCompensation.upsert({
      where: { tenantId_memberId: { tenantId: input.ctx.tenantId, memberId: member.id } },
      update: data,
      create: { id: randomUUID(), tenantId: input.ctx.tenantId, memberId: member.id, ...data },
    });
    await writeAudit(
      {
        tenantId: input.ctx.tenantId,
        actorType: "USER",
        actorUserId: input.ctx.userId,
        actorMemberId: input.ctx.memberId,
        action: "payroll.compensation_update",
        resourceType: "member_compensation",
        resourceId: row.id,
        metadata: { memberId: member.id, baseSalary: row.baseSalary },
        ip: input.ip ?? null,
        userAgent: input.userAgent ?? null,
      },
      db as never,
    );
    return {
      id: row.id,
      memberId: member.id,
      memberName: member.user.name,
      memberEmail: member.user.email,
      divisionName: member.division?.name ?? null,
      baseSalary: row.baseSalary,
      attendanceAllowance: row.attendanceAllowance,
      transportAllowance: row.transportAllowance,
      mealAllowance: row.mealAllowance,
      overtimeHourlyRate: row.overtimeHourlyRate,
      effectiveFrom: row.effectiveFrom ? row.effectiveFrom.toISOString().slice(0, 10) : null,
      notes: row.notes,
    };
  });
}
