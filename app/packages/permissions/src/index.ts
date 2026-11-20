// Katalog permission aplikasi absensi.
// Permission dikelompokkan per domain; jumlah divalidasi oleh assertPermissionCatalog.

export const PERMISSIONS = {
  workspace: ["workspace.read", "workspace.manage"],
  member: ["member.read", "member.invite", "member.manage", "role.manage"],
  creator: [
    "creator.read",
    "creator.write",
    "creator.delete",
    "creator.assign",
    "creator.blacklist",
    "creator.export",
  ],
  campaign: ["campaign.read", "campaign.write", "campaign.publish", "campaign.delete"],
  shop: ["shop.read", "shop.connect", "shop.disconnect", "shop.sync"],
  analytics: ["analytics.read", "analytics.export"],
  outreach: ["outreach.read", "outreach.send"],
  audit: ["audit.read"],
  office: ["office.manage"],
  attendance: ["attendance.read"],
  correction: ["correction.read", "correction.review"],
  job: ["job.read", "job.retry"],
} as const;

type PermissionGroups = typeof PERMISSIONS;

export type PermissionKey = PermissionGroups[keyof PermissionGroups][number];

export const ALL_PERMISSIONS: readonly PermissionKey[] = Object.values(PERMISSIONS)
  .flat()
  .sort() as PermissionKey[];

const PERMISSION_SET: ReadonlySet<string> = new Set(ALL_PERMISSIONS);

export function isPermissionKey(value: string): value is PermissionKey {
  return PERMISSION_SET.has(value);
}

export const ROLE_KEYS = [
  "WORKSPACE_OWNER",
  "WORKSPACE_ADMIN",
  "HR",
  "AFFILIATE_MANAGER",
  "BUSINESS_DEVELOPMENT",
  "ANALYST",
  "EMPLOYEE",
  "VIEWER",
] as const;

export type RoleKey = (typeof ROLE_KEYS)[number];

export const ROLE_LABELS: Record<RoleKey, string> = {
  WORKSPACE_OWNER: "Workspace Owner",
  WORKSPACE_ADMIN: "Workspace Admin",
  HR: "HR",
  AFFILIATE_MANAGER: "Affiliate Manager",
  BUSINESS_DEVELOPMENT: "Business Development",
  ANALYST: "Analyst",
  EMPLOYEE: "Employee",
  VIEWER: "Viewer",
};

/** Matriks role → permission. Sumber kebenaran untuk seeding dan test. */
export const ROLE_PERMISSIONS: Record<RoleKey, readonly PermissionKey[]> = {
  WORKSPACE_OWNER: ALL_PERMISSIONS,
  WORKSPACE_ADMIN: ALL_PERMISSIONS.filter((p) => p !== "workspace.manage"),
  HR: [
    "workspace.read",
    "member.read",
    "office.manage",
    "attendance.read",
    "correction.read",
    "correction.review",
    "audit.read",
  ],
  AFFILIATE_MANAGER: [
    "workspace.read",
    "member.read",
    "creator.read",
    "creator.write",
    "creator.assign",
    "creator.delete",
    "creator.blacklist",
    "creator.export",
    "campaign.read",
    "campaign.write",
    "campaign.publish",
    "campaign.delete",
    "shop.read",
    "analytics.read",
    "analytics.export",
    "outreach.read",
    "outreach.send",
  ],
  BUSINESS_DEVELOPMENT: [
    "workspace.read",
    "member.read",
    "creator.read",
    "creator.write",
    "creator.assign",
    "campaign.read",
    "shop.read",
    "analytics.read",
  ],
  ANALYST: [
    "workspace.read",
    "member.read",
    "creator.read",
    "creator.export",
    "campaign.read",
    "shop.read",
    "analytics.read",
    "analytics.export",
    "audit.read",
    "attendance.read",
    "correction.read",
  ],
  EMPLOYEE: ["workspace.read"],
  VIEWER: [
    "workspace.read",
    "member.read",
    "creator.read",
    "campaign.read",
    "shop.read",
    "analytics.read",
  ],
};

/** Ekspektasi murni (tanpa DB) untuk dipakai test matrix. */
export function roleHasPermission(role: RoleKey, permission: PermissionKey): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}

export function permissionsForRole(role: RoleKey): readonly PermissionKey[] {
  return ROLE_PERMISSIONS[role];
}

export function isRoleKey(value: string): value is RoleKey {
  return (ROLE_KEYS as readonly string[]).includes(value);
}

/** Gagal keras bila katalog tidak lengkap; dipanggil sebelum provisioning role. */
export function assertPermissionCatalog(): void {
  if (ALL_PERMISSIONS.length !== 31) {
    throw new Error(`Katalog permission harus 31 entri, ditemukan ${ALL_PERMISSIONS.length}`);
  }
  if (PERMISSION_SET.size !== ALL_PERMISSIONS.length) {
    throw new Error("Katalog permission mengandung duplikat");
  }
  for (const role of ROLE_KEYS) {
    if (ROLE_PERMISSIONS[role].length === 0) {
      throw new Error(`Role ${role} tidak punya permission`);
    }
    for (const permission of ROLE_PERMISSIONS[role]) {
      if (!PERMISSION_SET.has(permission)) {
        throw new Error(`Role ${role} memakai permission di luar katalog: ${permission}`);
      }
    }
  }
}
