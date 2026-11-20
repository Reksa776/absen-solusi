import assert from "node:assert/strict";
import test from "node:test";

import {
  ALL_PERMISSIONS,
  assertPermissionCatalog,
  isPermissionKey,
  isRoleKey,
  PERMISSIONS,
  ROLE_KEYS,
  ROLE_PERMISSIONS,
  roleHasPermission,
} from "./index.js";

test("katalog berisi 31 permission unik", () => {
  assert.equal(ALL_PERMISSIONS.length, 31);
  assert.equal(new Set(ALL_PERMISSIONS).size, 31);
});

test("distribusi per domain sesuai spesifikasi", () => {
  const expected: Record<string, number> = {
    workspace: 2,
    member: 4,
    creator: 6,
    campaign: 4,
    shop: 4,
    analytics: 2,
    outreach: 2,
    audit: 1,
    office: 1,
    attendance: 1,
    correction: 2,
    job: 2,
  };
  for (const [domain, count] of Object.entries(expected)) {
    assert.equal(PERMISSIONS[domain as keyof typeof PERMISSIONS].length, count, domain);
  }
});

test("setiap permission berformat domain.action", () => {
  for (const permission of ALL_PERMISSIONS) {
    assert.match(permission, /^[a-z]+\.[a-z]+$/);
    assert.equal(isPermissionKey(permission), true);
  }
  assert.equal(isPermissionKey("workspace"), false);
  assert.equal(isPermissionKey("WORKSPACE.READ"), false);
});

test("ada 8 role dan tidak ada SUPER_ADMIN", () => {
  assert.equal(ROLE_KEYS.length, 8);
  assert.equal(isRoleKey("SUPER_ADMIN"), false);
  assert.deepEqual(
    [...ROLE_KEYS].sort(),
    [
      "AFFILIATE_MANAGER",
      "ANALYST",
      "BUSINESS_DEVELOPMENT",
      "EMPLOYEE",
      "HR",
      "VIEWER",
      "WORKSPACE_ADMIN",
      "WORKSPACE_OWNER",
    ],
  );
});

test("OWNER memegang seluruh katalog, ADMIN kecuali workspace.manage", () => {
  assert.equal(ROLE_PERMISSIONS.WORKSPACE_OWNER.length, 31);
  assert.equal(ROLE_PERMISSIONS.WORKSPACE_ADMIN.length, 30);
  assert.equal(roleHasPermission("WORKSPACE_ADMIN", "workspace.manage"), false);
  assert.equal(roleHasPermission("WORKSPACE_ADMIN", "office.manage"), true);
});

test("setiap role punya permission dari katalog, tanpa duplikat", () => {
  for (const role of ROLE_KEYS) {
    const list = ROLE_PERMISSIONS[role];
    assert.ok(list.length > 0, role);
    assert.equal(new Set(list).size, list.length, role);
    for (const permission of list) {
      assert.equal(isPermissionKey(permission), true, `${role}:${permission}`);
    }
  }
});

test("VIEWER hanya baca, tidak bisa menulis apa pun", () => {
  assert.deepEqual([...ROLE_PERMISSIONS.VIEWER].sort(), [
    "analytics.read",
    "campaign.read",
    "creator.read",
    "member.read",
    "shop.read",
    "workspace.read",
  ]);
  for (const permission of ROLE_PERMISSIONS.VIEWER) {
    assert.ok(permission.endsWith(".read"));
  }
});

test("HR meninjau revisi dan mengelola kantor; EMPLOYEE hanya check-in/own data", () => {
  assert.equal(roleHasPermission("HR", "correction.review"), true);
  assert.equal(roleHasPermission("HR", "office.manage"), true);
  assert.equal(roleHasPermission("HR", "attendance.read"), true);
  assert.equal(roleHasPermission("EMPLOYEE", "workspace.read"), true);
  assert.equal(roleHasPermission("EMPLOYEE", "attendance.read"), false);
  assert.equal(roleHasPermission("EMPLOYEE", "correction.review"), false);
  assert.equal(roleHasPermission("EMPLOYEE", "member.read"), false);
});

test("matrix 8 role x 31 permission konsisten dengan daftar role", () => {
  let granted = 0;
  for (const role of ROLE_KEYS) {
    for (const permission of ALL_PERMISSIONS) {
      assert.equal(
        roleHasPermission(role, permission),
        ROLE_PERMISSIONS[role].includes(permission),
      );
      if (roleHasPermission(role, permission)) granted += 1;
    }
  }
  assert.equal(granted, 31 + 30 + 7 + 17 + 8 + 11 + 1 + 6);
});

test("assertPermissionCatalog tidak melempar untuk katalog lengkap", () => {
  assert.doesNotThrow(() => assertPermissionCatalog());
});
