import { isRoleKey } from "@absensi/permissions";
import { randomUUID } from "node:crypto";

import { withTenant, writeAudit, type Prisma, type TenantContext } from "@absensi/database";

import { HttpError } from "./http.js";
import { assertWorkspaceReadClaim } from "./workspaces.js";

export const APPROVAL_REQUEST_TYPES = [
  "CORRECTION",
  "LEAVE",
  "PERMIT",
  "OVERTIME",
  "OUT_OF_TOWN",
] as const;
export type ApprovalRequestType = (typeof APPROVAL_REQUEST_TYPES)[number];

export type ApprovalStepSummary = {
  id: string;
  level: number;
  approverRoleKey: string;
};

export type ApprovalWorkflowSummary = {
  id: string;
  requestType: ApprovalRequestType;
  isActive: boolean;
  steps: ApprovalStepSummary[];
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

function parseRequestType(value: unknown): ApprovalRequestType {
  if (
    typeof value !== "string" ||
    !(APPROVAL_REQUEST_TYPES as readonly string[]).includes(value)
  ) {
    throw new HttpError(400, "INVALID_REQUEST_TYPE", "Jenis pengajuan tidak valid");
  }
  return value as ApprovalRequestType;
}

export async function listApprovalWorkflows(input: {
  ctx: TenantContext;
  workspaceId: string;
}): Promise<ApprovalWorkflowSummary[]> {
  if (!input.ctx.permissions.includes("member.read")) {
    throw new HttpError(403, "FORBIDDEN", "Permission tidak mencukupi");
  }
  assertWorkspaceReadClaim(input.ctx, input.workspaceId);
  const rows = await withTenant(input.ctx, (db) =>
    db.approvalWorkflow.findMany({
      include: { steps: { orderBy: { level: "asc" } } },
      orderBy: { requestType: "asc" },
    }),
  );
  return rows.map((row) => ({
    id: row.id,
    requestType: row.requestType as ApprovalRequestType,
    isActive: row.isActive,
    steps: row.steps.map((step) => ({
      id: step.id,
      level: step.level,
      approverRoleKey: step.approverRoleKey,
    })),
  }));
}

export async function saveApprovalWorkflow(input: {
  ctx: TenantContext;
  workspaceId: string;
  requestType: string;
  steps: unknown;
  isActive?: boolean;
  ip?: string | null;
  userAgent?: string | null;
}): Promise<ApprovalWorkflowSummary> {
  assertManage(input.ctx);
  assertWorkspaceReadClaim(input.ctx, input.workspaceId);
  const requestType = parseRequestType(input.requestType);
  if (!Array.isArray(input.steps) || input.steps.length === 0 || input.steps.length > 5) {
    throw new HttpError(400, "INVALID_STEPS", "Alur harus berisi 1–5 level");
  }
  const steps = input.steps.map((raw, index) => {
    if (typeof raw !== "object" || raw === null) {
      throw new HttpError(400, "INVALID_STEPS", "Level approver tidak valid");
    }
    const role = (raw as { approverRoleKey?: unknown }).approverRoleKey;
    if (typeof role !== "string" || !isRoleKey(role)) {
      throw new HttpError(400, "INVALID_APPROVER_ROLE", "Role approver tidak valid");
    }
    return { level: index + 1, approverRoleKey: role };
  });

  return withTenant(input.ctx, (db) =>
    db.$transaction(async (tx) => {
      const workflow = await tx.approvalWorkflow.upsert({
        where: {
          tenantId_requestType: { tenantId: input.ctx.tenantId, requestType },
        },
        update: { isActive: input.isActive ?? true },
        create: {
          id: randomUUID(),
          tenantId: input.ctx.tenantId,
          requestType,
          isActive: input.isActive ?? true,
        },
      });
      await tx.approvalStep.deleteMany({ where: { workflowId: workflow.id } });
      await tx.approvalStep.createMany({
        data: steps.map((step) => ({
          id: randomUUID(),
          tenantId: input.ctx.tenantId,
          workflowId: workflow.id,
          level: step.level,
          approverRoleKey: step.approverRoleKey,
        })),
      });
      await writeAudit(
        {
          tenantId: input.ctx.tenantId,
          actorType: "USER",
          actorUserId: input.ctx.userId,
          actorMemberId: input.ctx.memberId,
          action: "approval.workflow_save",
          resourceType: "approval_workflow",
          resourceId: workflow.id,
          metadata: {
            requestType,
            levels: steps.length,
            roles: steps.map((step) => step.approverRoleKey),
          },
          ip: input.ip ?? null,
          userAgent: input.userAgent ?? null,
        },
        tx,
      );
      const saved = await tx.approvalWorkflow.findFirstOrThrow({
        where: { id: workflow.id },
        include: { steps: { orderBy: { level: "asc" } } },
      });
      return {
        id: saved.id,
        requestType: saved.requestType as ApprovalRequestType,
        isActive: saved.isActive,
        steps: saved.steps.map((step) => ({
          id: step.id,
          level: step.level,
          approverRoleKey: step.approverRoleKey,
        })),
      };
    }),
  );
}

export async function deleteApprovalWorkflow(input: {
  ctx: TenantContext;
  workspaceId: string;
  requestType: string;
  ip?: string | null;
  userAgent?: string | null;
}): Promise<void> {
  assertManage(input.ctx);
  assertWorkspaceReadClaim(input.ctx, input.workspaceId);
  const requestType = parseRequestType(input.requestType);
  await withTenant(input.ctx, (db) =>
    db.$transaction(async (tx) => {
      const workflow = await tx.approvalWorkflow.findFirst({
        where: { requestType },
      });
      if (!workflow) return;
      await tx.approvalWorkflow.delete({
        where: { tenantId_id: { tenantId: input.ctx.tenantId, id: workflow.id } },
      });
      await writeAudit(
        {
          tenantId: input.ctx.tenantId,
          actorType: "USER",
          actorUserId: input.ctx.userId,
          actorMemberId: input.ctx.memberId,
          action: "approval.workflow_delete",
          resourceType: "approval_workflow",
          resourceId: workflow.id,
          metadata: { requestType },
          ip: input.ip ?? null,
          userAgent: input.userAgent ?? null,
        },
        tx,
      );
    }),
  );
}

export type ResolvedApprovalStep = {
  workflowId: string;
  totalSteps: number;
  step: { id: string; level: number; approverRoleKey: string } | null;
};

/** Null berarti belum dikonfigurasi → perilaku review lama tetap berlaku. */
export async function resolveApprovalStep(
  tx: Prisma.TransactionClient,
  tenantId: string,
  requestType: ApprovalRequestType,
  currentLevel: number,
): Promise<ResolvedApprovalStep | null> {
  const workflow = await tx.approvalWorkflow.findFirst({
    where: { tenantId, requestType, isActive: true },
    include: { steps: { orderBy: { level: "asc" } } },
  });
  if (!workflow || workflow.steps.length === 0) return null;
  const step = workflow.steps.find((entry) => entry.level === currentLevel + 1) ?? null;
  return {
    workflowId: workflow.id,
    totalSteps: workflow.steps.length,
    step: step
      ? { id: step.id, level: step.level, approverRoleKey: step.approverRoleKey }
      : null,
  };
}

export function assertApprovalActor(input: {
  ctx: TenantContext;
  step: { approverRoleKey: string };
}): void {
  if (!input.ctx.roleKeys.includes(input.step.approverRoleKey)) {
    throw new HttpError(
      403,
      "APPROVAL_STEP_FORBIDDEN",
      "Tahap persetujuan ini bukan untuk role Anda",
    );
  }
}
