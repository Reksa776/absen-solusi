import { isRoleKey } from "@absensi/permissions";
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

export const APPROVAL_REQUEST_TYPES = [
  "CORRECTION",
  "LEAVE",
  "PERMIT",
  "OVERTIME",
  "OUT_OF_TOWN",
] as const;
export type ApprovalRequestType = (typeof APPROVAL_REQUEST_TYPES)[number];

export type ApprovalApproverSummary = {
  memberId: string;
  name: string;
  email: string;
};

export type ApprovalStepSummary = {
  id: string;
  level: number;
  approverRoleKey: string;
  approverMemberIds: string[];
  approvers: ApprovalApproverSummary[];
};

export type ApprovalWorkflowSummary = {
  id: string;
  requestType: ApprovalRequestType;
  isActive: boolean;
  steps: ApprovalStepSummary[];
};

export type ApprovalCandidate = ApprovalApproverSummary;

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

const APPROVER_INCLUDE = {
  approvers: {
    include: {
      member: {
        include: {
          user: { select: { name: true, email: true } },
        },
      },
    },
  },
} as const;

function mapStep(step: {
  id: string;
  level: number;
  approverRoleKey: string;
  approvers: Array<{
    memberId: string;
    member: { user: { name: string; email: string } };
  }>;
}): ApprovalStepSummary {
  const approvers = step.approvers
    .map((entry) => ({
      memberId: entry.memberId,
      name: entry.member.user.name,
      email: entry.member.user.email,
    }))
    .sort((left, right) => left.name.localeCompare(right.name, "id"));
  return {
    id: step.id,
    level: step.level,
    approverRoleKey: step.approverRoleKey,
    approverMemberIds: approvers.map((entry) => entry.memberId),
    approvers,
  };
}

export async function listApprovalCandidates(input: {
  ctx: TenantContext;
  workspaceId: string;
}): Promise<ApprovalCandidate[]> {
  if (!input.ctx.permissions.includes("member.read")) {
    throw new HttpError(403, "FORBIDDEN", "Permission tidak mencukupi");
  }
  assertWorkspaceReadClaim(input.ctx, input.workspaceId);
  const rows = await withTenant(input.ctx, (db) =>
    db.workspaceMember.findMany({
      where: { status: "ACTIVE" },
      select: {
        id: true,
        user: { select: { name: true, email: true } },
      },
      orderBy: { user: { name: "asc" } },
      take: 500,
    }),
  );
  return rows.map((row) => ({
    memberId: row.id,
    name: row.user.name,
    email: row.user.email,
  }));
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
      include: {
        steps: {
          include: APPROVER_INCLUDE,
          orderBy: { level: "asc" },
        },
      },
      orderBy: { requestType: "asc" },
    }),
  );
  return rows.map((row) => ({
    id: row.id,
    requestType: row.requestType as ApprovalRequestType,
    isActive: row.isActive,
    steps: row.steps.map(mapStep),
  }));
}

type ParsedStep = {
  level: number;
  approverRoleKey: string;
  approverMemberIds: string[];
};

function parseSteps(rawSteps: unknown): ParsedStep[] {
  if (!Array.isArray(rawSteps) || rawSteps.length === 0 || rawSteps.length > 5) {
    throw new HttpError(400, "INVALID_STEPS", "Alur harus berisi 1–5 level");
  }
  return rawSteps.map((raw, index) => {
    if (typeof raw !== "object" || raw === null) {
      throw new HttpError(400, "INVALID_STEPS", "Level approver tidak valid");
    }
    const entry = raw as {
      approverRoleKey?: unknown;
      approverMemberIds?: unknown;
    };
    const role =
      typeof entry.approverRoleKey === "string" &&
      isRoleKey(entry.approverRoleKey)
        ? entry.approverRoleKey
        : "WORKSPACE_ADMIN";
    if (entry.approverMemberIds !== undefined) {
      if (!Array.isArray(entry.approverMemberIds)) {
        throw new HttpError(
          400,
          "INVALID_APPROVER_MEMBER",
          "Daftar approver level tidak valid",
        );
      }
      const ids = [
        ...new Set(
          entry.approverMemberIds.filter(
            (value): value is string => typeof value === "string",
          ),
        ),
      ];
      if (ids.length === 0) {
        throw new HttpError(
          400,
          "INVALID_APPROVER_MEMBER",
          "Pilih minimal satu karyawan sebagai approver",
        );
      }
      if (ids.length > 20 || ids.some((value) => !isUuid(value))) {
        throw new HttpError(
          400,
          "INVALID_APPROVER_MEMBER",
          "Daftar approver level tidak valid",
        );
      }
      return {
        level: index + 1,
        approverRoleKey: role,
        approverMemberIds: ids,
      };
    }
    if (
      typeof entry.approverRoleKey !== "string" ||
      !isRoleKey(entry.approverRoleKey)
    ) {
      throw new HttpError(400, "INVALID_APPROVER_ROLE", "Role approver tidak valid");
    }
    return {
      level: index + 1,
      approverRoleKey: entry.approverRoleKey,
      approverMemberIds: [],
    };
  });
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
  const steps = parseSteps(input.steps);
  const memberIds = [...new Set(steps.flatMap((step) => step.approverMemberIds))];

  return withTenant(input.ctx, (db) =>
    db.$transaction(async (tx) => {
      if (memberIds.length > 0) {
        const members = await tx.workspaceMember.findMany({
          where: { id: { in: memberIds }, status: "ACTIVE" },
          select: { id: true },
        });
        if (members.length !== memberIds.length) {
          throw new HttpError(
            400,
            "INVALID_APPROVER_MEMBER",
            "Karyawan approver tidak ditemukan di workspace ini",
          );
        }
      }

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
      for (const step of steps) {
        const stepId = randomUUID();
        await tx.approvalStep.create({
          data: {
            id: stepId,
            tenantId: input.ctx.tenantId,
            workflowId: workflow.id,
            level: step.level,
            approverRoleKey: step.approverRoleKey,
          },
        });
        if (step.approverMemberIds.length > 0) {
          await tx.approvalStepApprover.createMany({
            data: step.approverMemberIds.map((memberId) => ({
              id: randomUUID(),
              tenantId: input.ctx.tenantId,
              stepId,
              memberId,
            })),
          });
        }
      }
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
            approverMemberIds: steps.map((step) => step.approverMemberIds),
          },
          ip: input.ip ?? null,
          userAgent: input.userAgent ?? null,
        },
        tx,
      );
      const saved = await tx.approvalWorkflow.findFirstOrThrow({
        where: { id: workflow.id },
        include: {
          steps: {
            include: APPROVER_INCLUDE,
            orderBy: { level: "asc" },
          },
        },
      });
      return {
        id: saved.id,
        requestType: saved.requestType as ApprovalRequestType,
        isActive: saved.isActive,
        steps: saved.steps.map(mapStep),
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
  step: {
    id: string;
    level: number;
    approverRoleKey: string;
    approverMemberIds: string[];
  } | null;
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
    include: {
      steps: {
        include: { approvers: { select: { memberId: true } } },
        orderBy: { level: "asc" },
      },
    },
  });
  if (!workflow || workflow.steps.length === 0) return null;
  const step = workflow.steps.find((entry) => entry.level === currentLevel + 1) ?? null;
  return {
    workflowId: workflow.id,
    totalSteps: workflow.steps.length,
    step: step
      ? {
          id: step.id,
          level: step.level,
          approverRoleKey: step.approverRoleKey,
          approverMemberIds: step.approvers.map((entry) => entry.memberId),
        }
      : null,
  };
}

export function assertApprovalActor(input: {
  ctx: TenantContext;
  step: { approverRoleKey: string; approverMemberIds: string[] };
}): void {
  if (input.step.approverMemberIds.length > 0) {
    if (!input.step.approverMemberIds.includes(input.ctx.memberId)) {
      throw new HttpError(
        403,
        "APPROVAL_STEP_FORBIDDEN",
        "Tahap persetujuan ini bukan untuk Anda",
      );
    }
    return;
  }
  if (!input.ctx.roleKeys.includes(input.step.approverRoleKey)) {
    throw new HttpError(
      403,
      "APPROVAL_STEP_FORBIDDEN",
      "Tahap persetujuan ini bukan untuk role Anda",
    );
  }
}
