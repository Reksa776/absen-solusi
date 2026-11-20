import assert from "node:assert/strict";
import test from "node:test";

import {
  evaluateInvitationRole,
  evaluateOwnershipTransfer,
  evaluateRoleChange,
  highestRoleRank,
  ROLE_RANK,
  roleRank,
  type SecurityDecision,
} from "./role-policy.js";

function denial(decision: SecurityDecision): { status: number; code: string } {
  assert.equal(decision.allowed, false);
  if (decision.allowed) throw new Error("unreachable");
  return { status: decision.status, code: decision.code };
}

const baseChange = {
  actorMemberId: "actor-member",
  actorRoleKeys: ["WORKSPACE_ADMIN"],
  targetMemberId: "target-member",
  targetRoleKeys: ["VIEWER"],
  nextRoleKey: "ANALYST" as const,
  ownerCount: 1,
};

test("S1-1: role hierarchy lengkap dan peringkat owner tertinggi", () => {
  assert.equal(ROLE_RANK.WORKSPACE_OWNER > ROLE_RANK.WORKSPACE_ADMIN, true);
  assert.equal(ROLE_RANK.WORKSPACE_ADMIN > ROLE_RANK.HR, true);
  assert.equal(ROLE_RANK.HR > ROLE_RANK.ANALYST, true);
  assert.equal(ROLE_RANK.VIEWER > ROLE_RANK.EMPLOYEE, true);
  assert.equal(ROLE_RANK.WORKSPACE_ADMIN > ROLE_RANK.ANALYST, true);
  assert.equal(ROLE_RANK.ANALYST > ROLE_RANK.VIEWER, true);
  assert.equal(roleRank("ROLE_TIDAK_DIKENAL"), 0);
  assert.equal(highestRoleRank(["VIEWER", "WORKSPACE_ADMIN"]), ROLE_RANK.WORKSPACE_ADMIN);
  assert.equal(highestRoleRank([]), 0);
});

test("S1-2: admin tidak dapat memberikan WORKSPACE_OWNER lewat role change", () => {
  const decision = evaluateRoleChange({ ...baseChange, nextRoleKey: "WORKSPACE_OWNER" });
  assert.deepEqual(denial(decision), { status: 403, code: "OWNERSHIP_TRANSFER_REQUIRED" });
});

test("S1-3: owner pun tidak dapat memberikan owner lewat role change biasa", () => {
  const decision = evaluateRoleChange({
    ...baseChange,
    actorRoleKeys: ["WORKSPACE_OWNER"],
    nextRoleKey: "WORKSPACE_OWNER",
  });
  assert.deepEqual(denial(decision), { status: 403, code: "OWNERSHIP_TRANSFER_REQUIRED" });
});

test("S1-4: admin tidak dapat menaikkan member ke admin (role setara)", () => {
  const decision = evaluateRoleChange({ ...baseChange, nextRoleKey: "WORKSPACE_ADMIN" });
  assert.deepEqual(denial(decision), { status: 403, code: "ROLE_HIERARCHY_VIOLATION" });
});

test("S1-5: admin tidak dapat mengubah admin lain atau owner", () => {
  const peer = evaluateRoleChange({
    ...baseChange,
    actorRoleKeys: ["WORKSPACE_ADMIN"],
    targetRoleKeys: ["WORKSPACE_ADMIN"],
    nextRoleKey: "VIEWER",
  });
  assert.deepEqual(denial(peer), { status: 403, code: "ROLE_HIERARCHY_VIOLATION" });

  const owner = evaluateRoleChange({
    ...baseChange,
    actorRoleKeys: ["WORKSPACE_ADMIN"],
    targetRoleKeys: ["WORKSPACE_OWNER"],
    nextRoleKey: "VIEWER",
    ownerCount: 2,
  });
  assert.deepEqual(denial(owner), { status: 403, code: "ROLE_HIERARCHY_VIOLATION" });
});

test("S1-6: owner dapat mengubah admin ke role lebih rendah, admin dapat mengubah viewer", () => {
  assert.deepEqual(
    evaluateRoleChange({
      ...baseChange,
      actorRoleKeys: ["WORKSPACE_OWNER"],
      targetRoleKeys: ["WORKSPACE_ADMIN"],
      nextRoleKey: "ANALYST",
    }),
    { allowed: true },
  );
  assert.deepEqual(evaluateRoleChange(baseChange), { allowed: true });
});

test("S1-7: self role change dan aktor tanpa peringkat manager ditolak", () => {
  assert.deepEqual(
    denial(evaluateRoleChange({ ...baseChange, targetMemberId: "actor-member" })),
    { status: 400, code: "SELF_ROLE_CHANGE" },
  );
  assert.deepEqual(
    denial(
      evaluateRoleChange({
        ...baseChange,
        actorRoleKeys: ["VIEWER"],
        targetRoleKeys: ["VIEWER"],
        nextRoleKey: "VIEWER",
      }),
    ),
    { status: 403, code: "FORBIDDEN" },
  );
});

test("S1-8: owner terakhir tidak dapat diturunkan", () => {
  const decision = evaluateRoleChange({
    ...baseChange,
    actorRoleKeys: ["WORKSPACE_OWNER"],
    targetRoleKeys: ["WORKSPACE_OWNER"],
    nextRoleKey: "WORKSPACE_ADMIN",
    ownerCount: 1,
  });
  assert.deepEqual(denial(decision), { status: 409, code: "LAST_OWNER_PROTECTED" });
});

test("S1-9: invitation tidak dapat membawa WORKSPACE_OWNER atau role setara aktor", () => {
  assert.deepEqual(
    denial(
      evaluateInvitationRole({
        actorRoleKeys: ["WORKSPACE_OWNER"],
        roleKey: "WORKSPACE_OWNER",
      }),
    ),
    { status: 403, code: "OWNERSHIP_TRANSFER_REQUIRED" },
  );
  assert.deepEqual(
    denial(
      evaluateInvitationRole({
        actorRoleKeys: ["WORKSPACE_ADMIN"],
        roleKey: "WORKSPACE_ADMIN",
      }),
    ),
    { status: 403, code: "ROLE_HIERARCHY_VIOLATION" },
  );
  assert.deepEqual(
    evaluateInvitationRole({ actorRoleKeys: ["WORKSPACE_ADMIN"], roleKey: "VIEWER" }),
    { allowed: true },
  );
});

test("S1-10: hanya owner yang dapat mentransfer ownership", () => {
  const input = {
    actorMemberId: "actor-member",
    actorRoleKeys: ["WORKSPACE_ADMIN"],
    targetMemberId: "target-member",
    targetRoleKeys: ["VIEWER"],
    targetStatus: "ACTIVE",
  };
  assert.deepEqual(denial(evaluateOwnershipTransfer(input)), {
    status: 403,
    code: "FORBIDDEN",
  });
  assert.deepEqual(
    evaluateOwnershipTransfer({ ...input, actorRoleKeys: ["WORKSPACE_OWNER"] }),
    { allowed: true },
  );
});

test("S1-11: transfer ke diri sendiri, member nonaktif, atau owner lain ditolak", () => {
  const owner = {
    actorMemberId: "actor-member",
    actorRoleKeys: ["WORKSPACE_OWNER"],
    targetMemberId: "target-member",
    targetRoleKeys: ["VIEWER"],
    targetStatus: "ACTIVE",
  };
  assert.deepEqual(
    denial(evaluateOwnershipTransfer({ ...owner, targetMemberId: "actor-member" })),
    { status: 400, code: "SELF_OWNERSHIP_TRANSFER" },
  );
  assert.deepEqual(
    denial(evaluateOwnershipTransfer({ ...owner, targetStatus: "INACTIVE" })),
    { status: 404, code: "MEMBER_NOT_FOUND" },
  );
  assert.deepEqual(
    denial(evaluateOwnershipTransfer({ ...owner, targetRoleKeys: ["WORKSPACE_OWNER"] })),
    { status: 409, code: "ALREADY_OWNER" },
  );
});
