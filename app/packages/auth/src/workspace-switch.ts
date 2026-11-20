import { systemDb, writeAudit } from "@absensi/database";

import { HttpError } from "./http.js";

export type SwitchActiveWorkspaceInput = {
  sessionId: string;
  userId: string;
  currentTenantId: string | null;
  workspaceId: string;
  ip?: string | null | undefined;
  userAgent?: string | null | undefined;
};

export type SwitchActiveWorkspaceResult = {
  activeTenantId: string;
  workspace: { id: string; name: string; slug: string };
  roleKeys: string[];
};

/**
 * Pindah workspace hanya boleh ke membership ACTIVE milik user pada session
 * yang sedang dipakai. Workspace asing dan tidak ada sama-sama 403.
 */
export async function switchActiveWorkspace(
  input: SwitchActiveWorkspaceInput,
): Promise<SwitchActiveWorkspaceResult> {
  // SYSTEM: session adalah entitas platform-level; membership diverifikasi
  // sebelum tenant context dapat dibentuk.
  const db = systemDb();
  const membership = await db.workspaceMember.findFirst({
    where: {
      tenantId: input.workspaceId,
      userId: input.userId,
      status: "ACTIVE",
      workspace: { status: "ACTIVE" },
    },
    include: {
      workspace: { select: { id: true, name: true, slug: true } },
      roles: { include: { role: { select: { key: true } } } },
    },
  });
  if (!membership) {
    throw new HttpError(
      403,
      "WORKSPACE_FORBIDDEN",
      "Workspace tidak ditemukan atau Anda bukan member aktif",
    );
  }

  await db.$transaction(async (tx) => {
    const updated = await tx.session.updateMany({
      where: { id: input.sessionId, userId: input.userId, revokedAt: null },
      data: { activeTenantId: membership.tenantId },
    });
    if (updated.count !== 1) {
      throw new HttpError(401, "UNAUTHENTICATED", "Sesi tidak valid");
    }
    await writeAudit(
      {
        tenantId: membership.tenantId,
        actorType: "USER",
        actorUserId: input.userId,
        actorMemberId: membership.id,
        action: "workspace.switch_tenant",
        resourceType: "workspace",
        resourceId: membership.tenantId,
        metadata: {
          fromTenantId: input.currentTenantId,
          toTenantId: membership.tenantId,
        },
        ip: input.ip ?? null,
        userAgent: input.userAgent ?? null,
      },
      tx,
    );
  });

  return {
    activeTenantId: membership.tenantId,
    workspace: membership.workspace,
    roleKeys: membership.roles.map((assignment) => assignment.role.key).sort(),
  };
}
