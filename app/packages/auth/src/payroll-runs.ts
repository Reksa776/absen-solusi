import { randomUUID } from "node:crypto";

import { isUuid, withTenant, writeAudit, type TenantContext } from "@absensi/database";

import { HttpError } from "./http.js";
import { createInAppNotification } from "./inbox.js";
import { calculateOvertimeBreakdown } from "./overtime-operations.js";
import { getPayrollSummary } from "./payroll.js";
import { parseReportDay } from "./reports.js";
import { assertWorkspaceReadClaim } from "./workspaces.js";

const DAY_MS = 86_400_000;
const MONEY_MAX = 2_000_000_000;
export const PAYROLL_RUN_STATUSES = ["DRAFT", "FINALIZED", "PAID"] as const;
export type PayrollRunStatus = (typeof PAYROLL_RUN_STATUSES)[number];

export type PayrollCalculationItem = {
  memberId: string;
  memberName: string;
  memberEmail: string;
  divisionName: string | null;
  baseSalary: number;
  attendanceAllowance: number;
  transportAllowance: number;
  mealAllowance: number;
  overtimeMinutes: number;
  overtimeRate: number;
  overtimePay: number;
  lateMinutes: number;
  lateIncidents: number;
  lateDeduction: number;
  spLevel: string | null;
  spDeduction: number;
  leaveDays: number;
  permitDays: number;
  grossPay: number;
  totalDeductions: number;
  netPay: number;
};

export type PayrollCalculation = {
  year: number;
  month: number;
  from: string;
  to: string;
  currency: string;
  items: PayrollCalculationItem[];
  totals: {
    memberCount: number;
    totalGross: number;
    totalDeductions: number;
    totalNet: number;
  };
};

export type PayrollRunSummary = {
  id: string;
  periodYear: number;
  periodMonth: number;
  status: PayrollRunStatus;
  currency: string;
  totalGross: number;
  totalDeductions: number;
  totalNet: number;
  memberCount: number;
  notes: string | null;
  generatedByName: string;
  finalizedAt: string | null;
  paidAt: string | null;
  paymentReference: string | null;
  createdAt: string;
};

export type PayrollRunDetail = PayrollRunSummary & {
  items: Array<PayrollCalculationItem & { id: string }>;
};

export type MyPayslip = {
  runId: string;
  periodYear: number;
  periodMonth: number;
  status: "FINALIZED" | "PAID";
  currency: string;
  paidAt: string | null;
  item: PayrollCalculationItem;
};

function assertManage(ctx: TenantContext): void {
  if (
    !ctx.permissions.includes("member.manage") &&
    !ctx.roleKeys.includes("WORKSPACE_OWNER") &&
    !ctx.roleKeys.includes("WORKSPACE_ADMIN")
  ) {
    throw new HttpError(403, "FORBIDDEN", "Permission tidak mencukupi");
  }
}

function parsePeriod(yearValue: unknown, monthValue: unknown): { year: number; month: number } {
  const year = Number(yearValue);
  const month = Number(monthValue);
  if (!Number.isInteger(year) || year < 2000 || year > 2100) {
    throw new HttpError(400, "INVALID_YEAR", "Tahun payroll tidak valid");
  }
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    throw new HttpError(400, "INVALID_MONTH", "Bulan payroll harus 1–12");
  }
  return { year, month };
}

function periodRange(year: number, month: number): { from: Date; to: Date; fromKey: string; toKey: string } {
  const from = new Date(Date.UTC(year, month - 1, 1));
  const to = new Date(Date.UTC(year, month, 0));
  return {
    from,
    to,
    fromKey: from.toISOString().slice(0, 10),
    toKey: to.toISOString().slice(0, 10),
  };
}

function money(value: number): number {
  return Math.max(0, Math.min(MONEY_MAX, Math.round(value)));
}

function spRank(level: string | null): number {
  if (!level) return 0;
  const normalized = level.toUpperCase();
  if (normalized === "SP3") return 3;
  if (normalized === "SP2") return 2;
  if (normalized === "SP1") return 1;
  return 0;
}

function dayKey(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function toRunSummary(row: {
  id: string;
  periodYear: number;
  periodMonth: number;
  status: string;
  currency: string;
  totalGross: number;
  totalDeductions: number;
  totalNet: number;
  notes: string | null;
  finalizedAt: Date | null;
  paidAt: Date | null;
  paymentReference: string | null;
  createdAt: Date;
  generator: { user: { name: string } };
  _count: { items: number };
}): PayrollRunSummary {
  return {
    id: row.id,
    periodYear: row.periodYear,
    periodMonth: row.periodMonth,
    status: row.status as PayrollRunStatus,
    currency: row.currency,
    totalGross: row.totalGross,
    totalDeductions: row.totalDeductions,
    totalNet: row.totalNet,
    memberCount: row._count.items,
    notes: row.notes,
    generatedByName: row.generator.user.name,
    finalizedAt: row.finalizedAt ? row.finalizedAt.toISOString() : null,
    paidAt: row.paidAt ? row.paidAt.toISOString() : null,
    paymentReference: row.paymentReference,
    createdAt: row.createdAt.toISOString(),
  };
}

function toItem(row: {
  id?: string;
  memberId: string;
  baseSalary: number;
  attendanceAllowance: number;
  transportAllowance: number;
  mealAllowance: number;
  overtimeMinutes: number;
  overtimeRate: number;
  overtimePay: number;
  lateMinutes: number;
  lateIncidents: number;
  lateDeduction: number;
  spLevel: string | null;
  spDeduction: number;
  leaveDays: number;
  permitDays: number;
  grossPay: number;
  totalDeductions: number;
  netPay: number;
  member: {
    user: { name: string; email: string };
    division: { name: string } | null;
  };
}): PayrollCalculationItem & { id: string } {
  return {
    id: row.id ?? row.memberId,
    memberId: row.memberId,
    memberName: row.member.user.name,
    memberEmail: row.member.user.email,
    divisionName: row.member.division?.name ?? null,
    baseSalary: row.baseSalary,
    attendanceAllowance: row.attendanceAllowance,
    transportAllowance: row.transportAllowance,
    mealAllowance: row.mealAllowance,
    overtimeMinutes: row.overtimeMinutes,
    overtimeRate: row.overtimeRate,
    overtimePay: row.overtimePay,
    lateMinutes: row.lateMinutes,
    lateIncidents: row.lateIncidents,
    lateDeduction: row.lateDeduction,
    spLevel: row.spLevel,
    spDeduction: row.spDeduction,
    leaveDays: row.leaveDays,
    permitDays: row.permitDays,
    grossPay: row.grossPay,
    totalDeductions: row.totalDeductions,
    netPay: row.netPay,
  };
}

async function calculate(
  input: {
    ctx: TenantContext;
    workspaceId: string;
    year: unknown;
    month: unknown;
    now?: Date | undefined;
  },
): Promise<PayrollCalculation> {
  assertManage(input.ctx);
  assertWorkspaceReadClaim(input.ctx, input.workspaceId);
  const { year, month } = parsePeriod(input.year, input.month);
  const range = periodRange(year, month);
  const summary = await getPayrollSummary({
    ctx: input.ctx,
    workspaceId: input.workspaceId,
    from: range.fromKey,
    to: range.toKey,
    now: input.now,
  });

  return withTenant(input.ctx, async (db) => {
    const [
      setting,
      compensations,
      leaves,
      permits,
      warnings,
      members,
      overtimePolicy,
      overtimeRows,
      holidays,
    ] = await Promise.all([
      db.payrollSetting.findFirst(),
      db.memberCompensation.findMany(),
      db.leaveRequest.findMany({
        where: {
          status: "APPROVED",
          startDate: { lte: range.to },
          endDate: { gte: range.from },
        },
        select: { memberId: true, workingDays: true, startDate: true, endDate: true },
      }),
      db.workPermit.findMany({
        where: {
          status: "APPROVED",
          startDate: { lte: range.to },
          endDate: { gte: range.from },
        },
        select: { memberId: true, startDate: true, endDate: true },
      }),
      db.warningLetter.findMany({
        where: {
          issuedAt: { lte: range.to },
          validUntil: { gte: range.to },
        },
        select: { memberId: true, level: true },
      }),
      db.workspaceMember.findMany({
        where: { id: { in: summary.members.map((member) => member.memberId) } },
        include: {
          user: { select: { name: true, email: true } },
          division: { select: { name: true } },
        },
      }),
      db.overtimeSetting.findFirst(),
      db.overtimeRequest.findMany({
        where: {
          status: "APPROVED",
          date: { gte: range.from, lte: range.to },
        },
        select: { memberId: true, date: true, durationMinutes: true },
      }),
      db.workspaceHoliday.findMany({
        where: { date: { gte: range.from, lte: range.to } },
        select: { date: true },
      }),
    ]);
    const holidayDates = new Set(holidays.map((row) => dayKey(row.date)));
    const overtimeByMember = new Map<
      string,
      Array<{ date: Date; durationMinutes: number }>
    >();
    for (const row of overtimeRows) {
      const list = overtimeByMember.get(row.memberId) ?? [];
      list.push({ date: row.date, durationMinutes: row.durationMinutes });
      overtimeByMember.set(row.memberId, list);
    }
    const compensationByMember = new Map(compensations.map((row) => [row.memberId, row]));
    const memberById = new Map(members.map((row) => [row.id, row]));
    const leaveByMember = new Map<string, number>();
    for (const row of leaves) leaveByMember.set(row.memberId, (leaveByMember.get(row.memberId) ?? 0) + row.workingDays);
    const permitByMember = new Map<string, number>();
    for (const row of permits) {
      const overlapStart = Math.max(row.startDate.getTime(), range.from.getTime());
      const overlapEnd = Math.min(row.endDate.getTime(), range.to.getTime());
      const days = Math.max(0, Math.floor((overlapEnd - overlapStart) / DAY_MS) + 1);
      permitByMember.set(row.memberId, (permitByMember.get(row.memberId) ?? 0) + days);
    }
    const warningByMember = new Map<string, string>();
    for (const row of warnings) {
      const current = warningByMember.get(row.memberId) ?? null;
      if (spRank(row.level) > spRank(current)) warningByMember.set(row.memberId, row.level.toUpperCase());
    }

    const items: PayrollCalculationItem[] = summary.members.map((member) => {
      const compensation = compensationByMember.get(member.memberId);
      const baseSalary = compensation?.baseSalary ?? setting?.baseSalary ?? 0;
      const attendanceAllowance = compensation?.attendanceAllowance ?? setting?.attendanceAllowance ?? 0;
      const transportAllowance = compensation?.transportAllowance ?? setting?.transportAllowance ?? 0;
      const mealAllowance = compensation?.mealAllowance ?? setting?.mealAllowance ?? 0;
      const overtimeRate = compensation?.overtimeHourlyRate ?? setting?.overtimeHourlyRate ?? 0;
      const overtime = calculateOvertimeBreakdown({
        setting: overtimePolicy
          ? {
              minDurationMinutes: overtimePolicy.minDurationMinutes,
              roundingMinutes: overtimePolicy.roundingMinutes,
              maxDailyMinutes: overtimePolicy.maxDailyMinutes,
              maxMonthlyMinutes: overtimePolicy.maxMonthlyMinutes,
            }
          : null,
        requests: overtimeByMember.get(member.memberId) ?? [],
        holidayDates,
      });
      const overtimePay = money(
        ((overtime.weekdayMinutes * (overtimePolicy?.weekdayMultiplier ?? 1) +
          overtime.holidayMinutes * (overtimePolicy?.holidayMultiplier ?? 1)) /
          60) *
          overtimeRate,
      );
      const scheduledDays = member.presentDays + member.absentDays;
      const proratedAttendance =
        scheduledDays === 0 ? 0 : Math.round((attendanceAllowance * member.presentDays) / scheduledDays);
      const lateDeduction = money(
        member.lateMinutes * (setting?.lateDeductionPerMinute ?? 0) +
          member.lateIncidents * (setting?.lateDeductionPerIncident ?? 0),
      );
      const spLevel = warningByMember.get(member.memberId) ?? null;
      const spDeduction =
        spLevel === "SP3"
          ? setting?.sp3Deduction ?? 0
          : spLevel === "SP2"
            ? setting?.sp2Deduction ?? 0
            : spLevel === "SP1"
              ? setting?.sp1Deduction ?? 0
              : 0;
      const grossPay = money(
        baseSalary + proratedAttendance + transportAllowance + mealAllowance + overtimePay,
      );
      const totalDeductions = money(lateDeduction + spDeduction);
      return {
        memberId: member.memberId,
        memberName: member.name,
        memberEmail: memberById.get(member.memberId)?.user.email ?? "",
        divisionName: memberById.get(member.memberId)?.division?.name ?? null,
        baseSalary,
        attendanceAllowance: proratedAttendance,
        transportAllowance,
        mealAllowance,
        overtimeMinutes: overtime.minutes,
        overtimeRate,
        overtimePay,
        lateMinutes: member.lateMinutes,
        lateIncidents: member.lateIncidents,
        lateDeduction,
        spLevel,
        spDeduction,
        leaveDays: leaveByMember.get(member.memberId) ?? 0,
        permitDays: permitByMember.get(member.memberId) ?? 0,
        grossPay,
        totalDeductions,
        netPay: money(grossPay - totalDeductions),
      };
    });
    const totals = items.reduce(
      (acc, item) => {
        acc.memberCount += 1;
        acc.totalGross += item.grossPay;
        acc.totalDeductions += item.totalDeductions;
        acc.totalNet += item.netPay;
        return acc;
      },
      { memberCount: 0, totalGross: 0, totalDeductions: 0, totalNet: 0 },
    );
    return {
      year,
      month,
      from: range.fromKey,
      to: range.toKey,
      currency: setting?.currency ?? "IDR",
      items,
      totals,
    };
  });
}

export async function previewPayroll(input: {
  ctx: TenantContext;
  workspaceId: string;
  year: unknown;
  month: unknown;
  now?: Date | undefined;
}): Promise<PayrollCalculation> {
  return calculate(input);
}

export async function generatePayrollRun(input: {
  ctx: TenantContext;
  workspaceId: string;
  year: unknown;
  month: unknown;
  notes?: unknown;
  now?: Date | undefined;
  ip?: string | null;
  userAgent?: string | null;
}): Promise<PayrollRunDetail> {
  assertManage(input.ctx);
  const calculation = await calculate(input);
  const notes =
    typeof input.notes === "string" && input.notes.trim() !== ""
      ? input.notes.trim()
      : null;
  if (notes && notes.length > 1000) {
    throw new HttpError(400, "INVALID_NOTES", "Catatan maksimal 1000 karakter");
  }
  const runId = await withTenant(input.ctx, (db) =>
    db.$transaction(async (tx) => {
      const existing = await tx.payrollRun.findFirst({
        where: { periodYear: calculation.year, periodMonth: calculation.month },
      });
      if (existing && existing.status !== "DRAFT") {
        throw new HttpError(
          409,
          "PAYROLL_RUN_LOCKED",
          "Payroll yang sudah difinalkan tidak dapat dihitung ulang",
        );
      }
      let id = existing?.id ?? randomUUID();
      if (existing) {
        await tx.payrollItem.deleteMany({ where: { runId: existing.id } });
        await tx.payrollRun.update({
          where: { tenantId_id: { tenantId: input.ctx.tenantId, id: existing.id } },
          data: {
            currency: calculation.currency,
            totalGross: calculation.totals.totalGross,
            totalDeductions: calculation.totals.totalDeductions,
            totalNet: calculation.totals.totalNet,
            notes,
            generatedByMemberId: input.ctx.memberId,
          },
        });
        id = existing.id;
      } else {
        const created = await tx.payrollRun.create({
          data: {
            id,
            tenantId: input.ctx.tenantId,
            periodYear: calculation.year,
            periodMonth: calculation.month,
            currency: calculation.currency,
            totalGross: calculation.totals.totalGross,
            totalDeductions: calculation.totals.totalDeductions,
            totalNet: calculation.totals.totalNet,
            notes,
            generatedByMemberId: input.ctx.memberId,
          },
        });
        id = created.id;
      }
      if (calculation.items.length > 0) {
        await tx.payrollItem.createMany({
          data: calculation.items.map((item) => ({
            id: randomUUID(),
            tenantId: input.ctx.tenantId,
            runId: id,
            memberId: item.memberId,
            baseSalary: item.baseSalary,
            attendanceAllowance: item.attendanceAllowance,
            transportAllowance: item.transportAllowance,
            mealAllowance: item.mealAllowance,
            overtimeMinutes: item.overtimeMinutes,
            overtimeRate: item.overtimeRate,
            overtimePay: item.overtimePay,
            lateMinutes: item.lateMinutes,
            lateIncidents: item.lateIncidents,
            lateDeduction: item.lateDeduction,
            spLevel: item.spLevel,
            spDeduction: item.spDeduction,
            leaveDays: item.leaveDays,
            permitDays: item.permitDays,
            grossPay: item.grossPay,
            totalDeductions: item.totalDeductions,
            netPay: item.netPay,
          })),
        });
      }
      await writeAudit(
        {
          tenantId: input.ctx.tenantId,
          actorType: "USER",
          actorUserId: input.ctx.userId,
          actorMemberId: input.ctx.memberId,
          action: "payroll.generate",
          resourceType: "payroll_run",
          resourceId: id,
          metadata: {
            periodYear: calculation.year,
            periodMonth: calculation.month,
            memberCount: calculation.totals.memberCount,
            totalNet: calculation.totals.totalNet,
            regenerated: Boolean(existing),
          },
          ip: input.ip ?? null,
          userAgent: input.userAgent ?? null,
        },
        tx,
      );
      return id;
    }),
  );
  return getPayrollRun({ ctx: input.ctx, workspaceId: input.workspaceId, runId });
}

const RUN_INCLUDE = {
  generator: { include: { user: { select: { name: true } } } },
  _count: { select: { items: true } },
} as const;

export async function listPayrollRuns(input: {
  ctx: TenantContext;
  workspaceId: string;
  year?: string | undefined;
}): Promise<PayrollRunSummary[]> {
  assertManage(input.ctx);
  assertWorkspaceReadClaim(input.ctx, input.workspaceId);
  const year = input.year ? Number(input.year) : undefined;
  if (year !== undefined && (!Number.isInteger(year) || year < 2000 || year > 2100)) {
    throw new HttpError(400, "INVALID_YEAR", "Tahun payroll tidak valid");
  }
  const rows = await withTenant(input.ctx, (db) =>
    db.payrollRun.findMany({
      where: year ? { periodYear: year } : {},
      include: RUN_INCLUDE,
      orderBy: [{ periodYear: "desc" }, { periodMonth: "desc" }],
      take: 120,
    }),
  );
  return rows.map(toRunSummary);
}

export async function getPayrollRun(input: {
  ctx: TenantContext;
  workspaceId: string;
  runId: string;
}): Promise<PayrollRunDetail> {
  assertManage(input.ctx);
  assertWorkspaceReadClaim(input.ctx, input.workspaceId);
  if (!isUuid(input.runId)) throw new HttpError(404, "PAYROLL_RUN_NOT_FOUND", "Payroll tidak ditemukan");
  const row = await withTenant(input.ctx, (db) =>
    db.payrollRun.findFirst({
      where: { id: input.runId },
      include: {
        ...RUN_INCLUDE,
        items: {
          include: {
            member: {
              include: {
                user: { select: { name: true, email: true } },
                division: { select: { name: true } },
              },
            },
          },
          orderBy: [{ member: { user: { name: "asc" } } }],
        },
      },
    }),
  );
  if (!row) throw new HttpError(404, "PAYROLL_RUN_NOT_FOUND", "Payroll tidak ditemukan");
  return { ...toRunSummary(row), items: row.items.map(toItem) };
}

export async function finalizePayrollRun(input: {
  ctx: TenantContext;
  workspaceId: string;
  runId: string;
  now?: Date;
  ip?: string | null;
  userAgent?: string | null;
}): Promise<PayrollRunDetail> {
  assertManage(input.ctx);
  assertWorkspaceReadClaim(input.ctx, input.workspaceId);
  if (!isUuid(input.runId)) throw new HttpError(404, "PAYROLL_RUN_NOT_FOUND", "Payroll tidak ditemukan");
  await withTenant(input.ctx, (db) =>
    db.$transaction(async (tx) => {
      const run = await tx.payrollRun.findFirst({
        where: { id: input.runId },
        include: { items: true },
      });
      if (!run) throw new HttpError(404, "PAYROLL_RUN_NOT_FOUND", "Payroll tidak ditemukan");
      if (run.status !== "DRAFT") {
        throw new HttpError(409, "INVALID_PAYROLL_STATUS", "Hanya payroll DRAFT yang dapat difinalkan");
      }
      if (run.items.length === 0) {
        throw new HttpError(409, "PAYROLL_EMPTY", "Payroll belum memiliki item");
      }
      const now = input.now ?? new Date();
      await tx.payrollRun.update({
        where: { tenantId_id: { tenantId: input.ctx.tenantId, id: run.id } },
        data: { status: "FINALIZED", finalizedAt: now },
      });
      for (const item of run.items) {
        await createInAppNotification(tx, {
          tenantId: input.ctx.tenantId,
          memberId: item.memberId,
          type: "PAYROLL_FINALIZED",
          title: `Slip gaji ${run.periodMonth}/${run.periodYear} tersedia`,
          body: "Slip gaji sudah difinalkan dan dapat dilihat pada menu Profil > Slip Gaji.",
          linkUrl: "/mobile/payslips",
        });
      }
      await writeAudit(
        {
          tenantId: input.ctx.tenantId,
          actorType: "USER",
          actorUserId: input.ctx.userId,
          actorMemberId: input.ctx.memberId,
          action: "payroll.finalize",
          resourceType: "payroll_run",
          resourceId: run.id,
          metadata: { periodYear: run.periodYear, periodMonth: run.periodMonth, memberCount: run.items.length },
          ip: input.ip ?? null,
          userAgent: input.userAgent ?? null,
        },
        tx,
      );
    }),
  );
  return getPayrollRun({ ctx: input.ctx, workspaceId: input.workspaceId, runId: input.runId });
}

export async function payPayrollRun(input: {
  ctx: TenantContext;
  workspaceId: string;
  runId: string;
  paymentReference: unknown;
  now?: Date;
  ip?: string | null;
  userAgent?: string | null;
}): Promise<PayrollRunDetail> {
  assertManage(input.ctx);
  assertWorkspaceReadClaim(input.ctx, input.workspaceId);
  if (!isUuid(input.runId)) throw new HttpError(404, "PAYROLL_RUN_NOT_FOUND", "Payroll tidak ditemukan");
  const reference =
    typeof input.paymentReference === "string" ? input.paymentReference.trim() : "";
  if (reference.length < 3 || reference.length > 120) {
    throw new HttpError(400, "INVALID_PAYMENT_REFERENCE", "Referensi pembayaran 3–120 karakter");
  }
  await withTenant(input.ctx, (db) =>
    db.$transaction(async (tx) => {
      const run = await tx.payrollRun.findFirst({
        where: { id: input.runId },
        include: { items: true },
      });
      if (!run) throw new HttpError(404, "PAYROLL_RUN_NOT_FOUND", "Payroll tidak ditemukan");
      if (run.status !== "FINALIZED") {
        throw new HttpError(409, "INVALID_PAYROLL_STATUS", "Payroll harus FINALIZED sebelum dibayar");
      }
      const now = input.now ?? new Date();
      await tx.payrollRun.update({
        where: { tenantId_id: { tenantId: input.ctx.tenantId, id: run.id } },
        data: { status: "PAID", paidAt: now, paymentReference: reference },
      });
      for (const item of run.items) {
        await createInAppNotification(tx, {
          tenantId: input.ctx.tenantId,
          memberId: item.memberId,
          type: "PAYROLL_PAID",
          title: `Gaji ${run.periodMonth}/${run.periodYear} telah dibayarkan`,
          body: `Pembayaran gaji telah dicatat dengan referensi ${reference}.`,
          linkUrl: "/mobile/payslips",
        });
      }
      await writeAudit(
        {
          tenantId: input.ctx.tenantId,
          actorType: "USER",
          actorUserId: input.ctx.userId,
          actorMemberId: input.ctx.memberId,
          action: "payroll.pay",
          resourceType: "payroll_run",
          resourceId: run.id,
          metadata: {
            periodYear: run.periodYear,
            periodMonth: run.periodMonth,
            paymentReference: reference,
            memberCount: run.items.length,
          },
          ip: input.ip ?? null,
          userAgent: input.userAgent ?? null,
        },
        tx,
      );
    }),
  );
  return getPayrollRun({ ctx: input.ctx, workspaceId: input.workspaceId, runId: input.runId });
}

export async function listMyPayslips(input: {
  ctx: TenantContext;
}): Promise<MyPayslip[]> {
  const rows = await withTenant(input.ctx, (db) =>
    db.payrollItem.findMany({
      where: {
        memberId: input.ctx.memberId,
        run: { status: { in: ["FINALIZED", "PAID"] } },
      },
      include: {
        run: true,
        member: {
          include: {
            user: { select: { name: true, email: true } },
            division: { select: { name: true } },
          },
        },
      },
      orderBy: [{ run: { periodYear: "desc" } }, { run: { periodMonth: "desc" } }],
      take: 60,
    }),
  );
  return rows.map((row) => ({
    runId: row.runId,
    periodYear: row.run.periodYear,
    periodMonth: row.run.periodMonth,
    status: row.run.status as "FINALIZED" | "PAID",
    currency: row.run.currency,
    paidAt: row.run.paidAt ? row.run.paidAt.toISOString() : null,
    item: toItem(row),
  }));
}

export async function getPayrollSlip(input: {
  ctx: TenantContext;
  workspaceId?: string | undefined;
  runId: string;
  memberId?: string | undefined;
}): Promise<MyPayslip> {
  if (!isUuid(input.runId)) throw new HttpError(404, "PAYROLL_RUN_NOT_FOUND", "Payroll tidak ditemukan");
  const isManager =
    input.ctx.permissions.includes("member.manage") ||
    input.ctx.roleKeys.includes("WORKSPACE_OWNER") ||
    input.ctx.roleKeys.includes("WORKSPACE_ADMIN");
  if (input.workspaceId) assertWorkspaceReadClaim(input.ctx, input.workspaceId);
  const targetMemberId = isManager ? input.memberId ?? input.ctx.memberId : input.ctx.memberId;
  if (!isUuid(targetMemberId)) throw new HttpError(400, "INVALID_MEMBER", "Member tidak valid");
  const row = await withTenant(input.ctx, (db) =>
    db.payrollItem.findFirst({
      where: { runId: input.runId, memberId: targetMemberId },
      include: {
        run: true,
        member: {
          include: {
            user: { select: { name: true, email: true } },
            division: { select: { name: true } },
          },
        },
      },
    }),
  );
  if (!row) throw new HttpError(404, "PAYSLIP_NOT_FOUND", "Slip gaji tidak ditemukan");
  if (!isManager && !["FINALIZED", "PAID"].includes(row.run.status)) {
    throw new HttpError(404, "PAYSLIP_NOT_FOUND", "Slip gaji belum tersedia");
  }
  return {
    runId: row.runId,
    periodYear: row.run.periodYear,
    periodMonth: row.run.periodMonth,
    status: row.run.status as "FINALIZED" | "PAID",
    currency: row.run.currency,
    paidAt: row.run.paidAt ? row.run.paidAt.toISOString() : null,
    item: toItem(row),
  };
}

function csvValue(value: string | number): string {
  const text = String(value);
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export const PAYROLL_REPORT_CSV_HEADER =
  "period,member_name,division,base_salary,attendance_allowance,transport_allowance,meal_allowance,overtime_minutes,overtime_pay,late_minutes,late_incidents,late_deduction,sp_level,sp_deduction,leave_days,permit_days,gross_pay,total_deductions,net_pay,status";

export function payrollRunToCsv(run: PayrollRunDetail): { csv: string; rowCount: number } {
  const lines = [PAYROLL_REPORT_CSV_HEADER];
  for (const item of run.items) {
    lines.push(
      [
        `${run.periodYear}-${String(run.periodMonth).padStart(2, "0")}`,
        item.memberName,
        item.divisionName ?? "",
        item.baseSalary,
        item.attendanceAllowance,
        item.transportAllowance,
        item.mealAllowance,
        item.overtimeMinutes,
        item.overtimePay,
        item.lateMinutes,
        item.lateIncidents,
        item.lateDeduction,
        item.spLevel ?? "",
        item.spDeduction,
        item.leaveDays,
        item.permitDays,
        item.grossPay,
        item.totalDeductions,
        item.netPay,
        run.status,
      ]
        .map(csvValue)
        .join(","),
    );
  }
  return { csv: `${lines.join("\r\n")}\r\n`, rowCount: lines.length - 1 };
}

export function formatPayrollPeriod(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, "0")}`;
}

export function payrollPeriodRange(year: number, month: number): { from: string; to: string } {
  const range = periodRange(year, month);
  return { from: range.fromKey, to: dayKey(range.to) };
}

export function isPayrollPeriodDay(value: string): boolean {
  return /^\d{4}-\d{2}$/.test(value) && !Number.isNaN(parseReportDay(`${value}-01`, "period").getTime());
}
