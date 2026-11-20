import { randomUUID } from "node:crypto";

import {
  assertPermissionCatalog,
  ALL_PERMISSIONS,
  ROLE_KEYS,
  ROLE_LABELS,
  ROLE_PERMISSIONS,
  type RoleKey,
} from "@absensi/permissions";

import type { Prisma } from "./generated/prisma/client.js";
import { systemDb } from "./client.js";

export class RbacProvisioningError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RbacProvisioningError";
  }
}

type Tx = Prisma.TransactionClient;

/** Gagal keras bila katalog permission di DB tidak lengkap/kosong. */
export async function assertCatalogSeeded(client: Tx | ReturnType<typeof systemDb>): Promise<void> {
  assertPermissionCatalog();
  const count = await client.permission.count();
  if (count !== ALL_PERMISSIONS.length) {
    throw new RbacProvisioningError(
      `Katalog permission di database tidak lengkap: ${count}/${ALL_PERMISSIONS.length}`,
    );
  }
}

/**
 * Provision seluruh role default + role_permissions untuk satu workspace.
 * Wajib dipanggil di dalam transaksi pembuatan workspace.
 */
export async function createDefaultRolesForWorkspace(
  tx: Tx,
  tenantId: string,
): Promise<Record<RoleKey, string>> {
  await assertCatalogSeeded(tx);

  const roleIds = {} as Record<RoleKey, string>;
  for (const roleKey of ROLE_KEYS) {
    const roleId = randomUUID();
    roleIds[roleKey] = roleId;
    await tx.role.create({
      data: { id: roleId, tenantId, key: roleKey, name: ROLE_LABELS[roleKey], isSystem: true },
    });
    const permissions = ROLE_PERMISSIONS[roleKey];
    if (permissions.length === 0) {
      throw new RbacProvisioningError(`Role ${roleKey} tidak punya permission`);
    }
    await tx.rolePermission.createMany({
      data: permissions.map((permissionKey) => ({ tenantId, roleId, permissionKey })),
    });
  }
  return roleIds;
}

/** Permission efektif dari role yang dipegang seorang member. */
export async function resolveMemberPermissions(
  client: Tx | ReturnType<typeof systemDb>,
  tenantId: string,
  memberId: string,
): Promise<{ roleKeys: string[]; permissions: string[] }> {
  const assignments = await client.memberRole.findMany({
    where: { tenantId, memberId },
    include: { role: { include: { permissions: true } } },
  });
  const roleKeys = assignments.map((assignment) => assignment.role.key).sort();
  const permissions = [
    ...new Set(
      assignments.flatMap((assignment) =>
        assignment.role.permissions.map((grant) => grant.permissionKey),
      ),
    ),
  ].sort();
  return { roleKeys, permissions };
}
