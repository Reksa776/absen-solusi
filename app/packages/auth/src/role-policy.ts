import type { RoleKey } from "@absensi/permissions";

/**
 * Peringkat role untuk keputusan otorisasi. Sengaja tidak diturunkan dari
 * jumlah permission: role dengan permission banyak belum tentu boleh
 * memodifikasi role lain.
 */
export const ROLE_RANK: Record<RoleKey, number> = {
  WORKSPACE_OWNER: 40,
  WORKSPACE_ADMIN: 30,
  HR: 25,
  AFFILIATE_MANAGER: 20,
  BUSINESS_DEVELOPMENT: 20,
  ANALYST: 20,
  EMPLOYEE: 5,
  VIEWER: 10,
};

const MIN_ROLE_MANAGER_RANK = ROLE_RANK.WORKSPACE_ADMIN;

export type SecurityDecision =
  | { allowed: true }
  | { allowed: false; status: number; code: string; message: string };

function deny(status: number, code: string, message: string): SecurityDecision {
  return { allowed: false, status, code, message };
}

export function roleRank(roleKey: string): number {
  return (ROLE_RANK as Record<string, number>)[roleKey] ?? 0;
}

export function highestRoleRank(roleKeys: readonly string[]): number {
  let highest = 0;
  for (const key of roleKeys) highest = Math.max(highest, roleRank(key));
  return highest;
}

export type RoleChangePolicyInput = {
  actorMemberId: string;
  actorRoleKeys: readonly string[];
  targetMemberId: string;
  targetRoleKeys: readonly string[];
  nextRoleKey: RoleKey;
  /** Jumlah member yang memegang WORKSPACE_OWNER di tenant ini. */
  ownerCount: number;
};

/**
 * Aturan perubahan role biasa:
 * - tidak boleh mengubah role sendiri;
 * - WORKSPACE_OWNER tidak pernah diberikan lewat jalur ini;
 * - owner terakhir tidak boleh diturunkan;
 * - aktor minimal WORKSPACE_ADMIN;
 * - aktor hanya boleh memberi role di bawah peringkatnya dan hanya boleh
 *   mengubah member yang peringkatnya di bawah aktor.
 */
export function evaluateRoleChange(input: RoleChangePolicyInput): SecurityDecision {
  if (input.targetMemberId === input.actorMemberId) {
    return deny(400, "SELF_ROLE_CHANGE", "Tidak dapat mengubah role sendiri");
  }
  if (input.nextRoleKey === "WORKSPACE_OWNER") {
    return deny(
      403,
      "OWNERSHIP_TRANSFER_REQUIRED",
      "Ownership hanya dapat diberikan melalui transfer ownership",
    );
  }
  const actorRank = highestRoleRank(input.actorRoleKeys);
  if (actorRank < MIN_ROLE_MANAGER_RANK) {
    return deny(403, "FORBIDDEN", "Role Anda tidak dapat mengelola role");
  }
  if (input.targetRoleKeys.includes("WORKSPACE_OWNER") && input.ownerCount <= 1) {
    return deny(409, "LAST_OWNER_PROTECTED", "Owner terakhir tidak dapat diturunkan");
  }
  if (roleRank(input.nextRoleKey) >= actorRank) {
    return deny(
      403,
      "ROLE_HIERARCHY_VIOLATION",
      "Tidak dapat memberikan role setara atau lebih tinggi dari role Anda",
    );
  }
  if (highestRoleRank(input.targetRoleKeys) >= actorRank) {
    return deny(
      403,
      "ROLE_HIERARCHY_VIOLATION",
      "Tidak dapat mengubah member dengan role setara atau lebih tinggi",
    );
  }
  return { allowed: true };
}

export type InvitationRolePolicyInput = {
  actorRoleKeys: readonly string[];
  roleKey: RoleKey;
};

/** Undangan juga menetapkan role saat diterima, jadi tunduk pada aturan sama. */
export function evaluateInvitationRole(
  input: InvitationRolePolicyInput,
): SecurityDecision {
  if (input.roleKey === "WORKSPACE_OWNER") {
    return deny(
      403,
      "OWNERSHIP_TRANSFER_REQUIRED",
      "Ownership hanya dapat diberikan melalui transfer ownership",
    );
  }
  const actorRank = highestRoleRank(input.actorRoleKeys);
  if (actorRank < MIN_ROLE_MANAGER_RANK) {
    return deny(403, "FORBIDDEN", "Role Anda tidak dapat mengundang role ini");
  }
  if (roleRank(input.roleKey) >= actorRank) {
    return deny(
      403,
      "ROLE_HIERARCHY_VIOLATION",
      "Tidak dapat mengundang role setara atau lebih tinggi dari role Anda",
    );
  }
  return { allowed: true };
}

export type OwnershipTransferPolicyInput = {
  actorMemberId: string;
  actorRoleKeys: readonly string[];
  targetMemberId: string;
  targetRoleKeys: readonly string[];
  targetStatus: string;
};

/**
 * Transfer ownership adalah satu-satunya jalur sah untuk memindahkan
 * WORKSPACE_OWNER. Hanya owner aktif yang boleh mentransfer, target harus
 * member ACTIVE yang belum owner.
 */
export function evaluateOwnershipTransfer(
  input: OwnershipTransferPolicyInput,
): SecurityDecision {
  if (!input.actorRoleKeys.includes("WORKSPACE_OWNER")) {
    return deny(403, "FORBIDDEN", "Hanya owner workspace yang dapat mentransfer ownership");
  }
  if (input.targetMemberId === input.actorMemberId) {
    return deny(400, "SELF_OWNERSHIP_TRANSFER", "Tidak dapat mentransfer ownership ke diri sendiri");
  }
  if (input.targetStatus !== "ACTIVE") {
    return deny(404, "MEMBER_NOT_FOUND", "Member tidak ditemukan");
  }
  if (input.targetRoleKeys.includes("WORKSPACE_OWNER")) {
    return deny(409, "ALREADY_OWNER", "Member sudah menjadi owner workspace");
  }
  return { allowed: true };
}
