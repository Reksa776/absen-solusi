export const WEB_EMPLOYEE_DENIED_MESSAGE =
  "Akses web khusus untuk Admin/HR. Silakan gunakan aplikasi mobile untuk melakukan absensi.";

export type WorkspaceWithRoles = {
  id: string;
  roleKeys: readonly string[];
};

/**
 * Web is blocked only for members whose entire active role set is EMPLOYEE.
 * A multi-role member who also holds an admin/HR role keeps web access.
 * Mobile login is intentionally checked separately by auth mode (Bearer).
 */
export function isEmployeeOnlyRoles(roleKeys: readonly string[]): boolean {
  return roleKeys.length > 0 && roleKeys.every((key) => key === "EMPLOYEE");
}

export function activeWorkspace<T extends WorkspaceWithRoles>(
  workspaces: readonly T[],
  activeTenantId: string | null,
): T | undefined {
  return workspaces.find((workspace) => workspace.id === activeTenantId) ?? workspaces[0];
}

export function dashboardPath(workspaceId: string): string {
  return `/workspaces/${workspaceId}/dashboard`;
}

export function isEmployeeOnlyActiveWorkspace(
  workspaces: readonly WorkspaceWithRoles[],
  activeTenantId: string | null,
): boolean {
  const workspace = activeWorkspace(workspaces, activeTenantId);
  return workspace ? isEmployeeOnlyRoles(workspace.roleKeys) : false;
}
