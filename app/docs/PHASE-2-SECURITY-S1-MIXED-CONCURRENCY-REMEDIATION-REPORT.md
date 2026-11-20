# Phase 2 — Security S-1 Mixed Concurrency Remediation Report

**Date:** 2026-11-19  
**Repository:** `/home/reksa/absen-solusi/app`  
**Scope:** S-1 mixed concurrency remediation, plus the S-1.1 no-op policy correction. Unit 2B/2C and Phase 3 were not started.  
**Final status:** **PASS WITH LIMITATIONS**

---

## 1. Executive Summary

The source-analysis race between `changeMemberRole()` and `transferOwnership()` was remediated.

Both operations now acquire the same `workspaces` row lock inside their transaction, before reading mutable membership or role state. All authorization and ownership decisions are re-read after the lock. Role deletion is restricted to assignments read under the lock; the previous blind `roleId != newRole` predicate was removed.

The S-1.1 follow-up corrects the no-op ordering: `evaluateRoleChange()` now runs before `changeMemberRole()` can return `{ changed: false }`. An owner-targeted PATCH therefore cannot bypass ownership policy merely because the requested role equals the target's current role. Allowed ordinary no-ops still return `{ changed: false }` after passing policy.

**Evidence:**

- S-1.1 targeted workspaces suite: **28/28 PASS**, exit 0.
- S-1.1 auth suite: **73/73 PASS**, exit 0.
- Auth build and auth typecheck: **exit 0**.
- Database/web/permissions suites and repository-wide typecheck were not rerun in S-1.1; their previous unchanged results were 21/21, 2/2, 9/9, and exit 0.
- S1-D10: **50 iterations, 0 zero-owner/multi-owner failures**; latest full-suite run recorded 39 PATCH successes / 11 conflicts (scheduler-dependent).
- S1-D11: **50 iterations, both operations succeeded consistently**.
- S1-D12: **50 iterations, exactly one transfer succeeded per iteration**.
- S1-D7 retained: **PASS**.
- S1-D13, S1-D14, S1-D15, and S1-D16: **PASS**.

**Limitations:**

1. S1-D14 exercises the same locking/write sequence inside a real `withTenant().$transaction()` but uses controlled fault injection in the test, not an injected fault inside `transferOwnership()` itself. The service transaction path is covered by D5/D7/D10/D11/D12, but direct service-level fault injection is not exposed.
2. The database still has no constraint enforcing exactly one owner; the guarantee is application-level.
3. Legacy workspaces with multiple owners are not cleaned up; transfer rejects them as before.
4. Audit remains best-effort; this was not changed.
5. There are still no HTTP handler tests (TD-S1-V2).

No migration, schema, `.env`, dependency, or framework change was made. No commit or push occurred.

---

## 2. Initial Git Baseline

| Item | Baseline |
|---|---|
| Git root | `/home/reksa/absen-solusi/app` |
| HEAD | `47e77c0527a4510c23d31017e78feaacdd978fd2` |
| Branch | `main` |
| Staged files | 5 |
| Unstaged modified files | 14 |
| Untracked files | 14 |
| Deleted/renamed | 0/0 |

Pre-existing staged work included the Phase 1 web shell. Pre-existing unstaged/untracked work from Phase 1, 2A, S-1, and S-1 verification was preserved. No reset, checkout, stash, clean, or branch change was used.

---

## 3. Root Cause

The defect had three parts:

1. **Asymmetric locking** — `transferOwnership()` acquired `workspaces ... FOR UPDATE`; `changeMemberRole()` did not acquire the same lock.
2. **Stale authorization state** — `changeMemberRole()` read target membership, target roles, owner count, and actor context before starting its transaction. Its transaction rechecked owner state only if the preflight target was already an owner.
3. **Blind deletion** — the role update used `deleteMany({ roleId: { not: newRoleId } })`, which could delete an owner assignment acquired after the preflight read.

Interleaving: PATCH reads T as `VIEWER`; transfer promotes T to `WORKSPACE_OWNER` and demotes the actor; PATCH's transaction runs with stale state, skips the owner recheck, and deletes T's owner role. The final state can have zero owners.

This remains a source-analysis finding. It was **not** deliberately reproduced against the old code in this run; the new regression tests validate the repaired implementation.

---

## 4. Files Changed and Attribution

### Changed by S-1.1 only

| File | S-1.1 change |
|---|---|
| `packages/auth/src/workspaces.ts` | Evaluate `evaluateRoleChange()` before the no-op return; no assignment or owner-invariant behavior changed |
| `packages/auth/src/workspaces.test.ts` | Added S1-D15 and S1-D16 |
| `docs/PHASE-2-SECURITY-S1-MIXED-CONCURRENCY-REMEDIATION-REPORT.md` | This report correction |

`packages/database/src/index.ts` was **not** touched by S-1.1.

### Full file history in the working tree

| File | S-1 mixed concurrency / S-1.1 | Unit 2A | Earlier S-1 / verification |
|---|---|---|---|
| `packages/auth/src/workspaces.ts` | Shared workspace lock helper; revalidation inside transaction; explicit role-ID deletion; transfer error ordering; S-1.1 no-op policy ordering | `listWorkspaceMembers()` and pagination | Original S-1 invitation guard, role-change policy, transfer ownership; verification workspace lock and owner invariant |
| `packages/auth/src/workspaces.test.ts` | S1-D10 through S1-D14; S-1.1 adds S1-D15/D16 | L1–L5 list/pagination tests | S1-D1–D6 original S-1; S1-D7–D9 verification |
| `packages/database/src/index.ts` | `Prisma` type export | Readiness exports (`checkReadiness`, `ReadinessChecks`, `ReadinessReport`) | None |
| `packages/auth/src/index.ts` | No S-1.1 change | List exports | Original S-1 transfer/policy exports |
| `packages/auth/src/route-policy.ts` | No S-1.1 change | Per-method policy and readiness entry | Ownership-transfer entry |
| `packages/auth/src/route-policy.test.ts` | No S-1.1 change | H1/H3/H4/H6 shaping | H4 ownership-transfer assertion |
| `apps/web/test/route-policy.test.mjs` | No S-1.1 change | Per-method scanning and readiness | Scans the final ownership route |
| `docs/PHASE-1.md`, `README.md` | No S-1.1 change | Unit 2A documentation links | Phase 1 documentation rewrite |

This table is a file-history view, not a claim that the full diff of each file belongs to one checkpoint. `packages/database/src/index.ts` contains both Unit 2A readiness exports and the mixed `Prisma` type export; it must not be committed as a mixed-only file. Existing baseline working-tree changes remain untouched.

---

## 5. Implementation Details

### Shared lock helper

`lockWorkspaceForRoleMutation(tx, tenantId)`:

- Executes `SELECT id FROM workspaces WHERE id = ? FOR UPDATE`.
- Verifies exactly one row.
- Re-reads workspace status and requires `ACTIVE`.
- Returns `404 WORKSPACE_NOT_FOUND` for missing/inactive workspace.
- Is called as the first statement in both role-mutation transactions.

### `changeMemberRole()`

Inside one transaction:

1. Acquires the workspace lock.
2. Re-reads actor membership and active status.
3. Re-resolves actor role keys and permissions; requires `role.manage`.
4. Re-reads target membership/status and target roles.
5. Requires target `ACTIVE`.
6. Re-reads requested role and owner role.
7. Computes owner count under the lock.
8. Re-evaluates `evaluateRoleChange()` with fresh actor/target roles.
9. Returns `{ changed: false }` only if policy allows and the target already has exactly the requested role.
10. Upserts the new role.
11. Deletes only role IDs that were read and are not the new role.
12. Rechecks that at least one owner remains.
13. Audits only after a successful commit.

### `transferOwnership()`

Inside one transaction:

1. Acquires the same workspace lock.
2. Re-reads workspace status, owner/admin roles.
3. Re-reads actor membership/status and effective permissions; requires `workspace.manage`.
4. Re-reads target membership/status and target roles.
5. Re-evaluates `evaluateOwnershipTransfer()` with fresh state.
6. Re-reads owner count; requires the actor to be the sole owner.
7. Promotes target, demotes actor, and verifies exactly one owner.
8. Audits after commit.

Error compatibility was preserved for the existing regression suite:

- Non-owner transfer: `403 FORBIDDEN`.
- Self transfer: `400 SELF_OWNERSHIP_TRANSFER`.
- Inactive target: `404 MEMBER_NOT_FOUND`.
- Existing owner target: `409 ALREADY_OWNER`.
- Lost concurrent ownership: `409 OWNERSHIP_CHANGED`.

A request that started as owner but lost ownership while waiting gets `OWNERSHIP_CHANGED` rather than a misleading `FORBIDDEN`; this uses the request context only to select the error code, not to authorize the operation.

---

## 6. Locking Protocol

**Mandatory order:**

```text
workspaces row
  -> actor/target workspace_members
  -> member_roles
```

Rules:

- Lock the stable workspace row first.
- Do not lock `member_roles` before `workspaces`.
- Do not re-use the earlier owner-row-first lock strategy; it previously produced `P2010`.
- Both `changeMemberRole()` and `transferOwnership()` use the exact same helper and order.
- The lock is held for the whole role mutation; audit is outside the transaction.

`workspaces.id` is the primary key, so the locking query targets one row.

---

## 7. Transaction Boundaries

- All mutable membership/role reads used for authorization occur inside the transaction.
- `withTenant()` still supplies tenant filtering; the raw lock query uses `ctx.tenantId` after `assertWorkspaceClaim()`.
- The lock, revalidation, all role writes, and the owner-count invariant check are atomic.
- Audit remains after commit and best-effort; it is not part of the authorization guarantee.
- Transaction failures are not swallowed.

---

## 8. Authorization Revalidation

| Check | `changeMemberRole` | `transferOwnership` |
|---|---|---|
| Workspace exists/ACTIVE | Yes, after lock | Yes, after lock |
| Actor active membership | Yes | Yes |
| Actor fresh roles | Yes | Yes |
| Actor effective permission | `role.manage` | `workspace.manage` |
| Target active membership | Yes | Yes |
| Target fresh roles | Yes | Yes |
| Requested role exists | Yes | N/A |
| Owner count fresh | Yes | Yes |
| Actor sole-owner constraint | N/A | Yes |
| Last-owner protection | Yes | Yes |
| Exact owner count after transfer | At least one after role change | Exactly one |

The request `ctx.roleKeys` is no longer used for authorization decisions. It is used only to preserve `OWNERSHIP_CHANGED` when an owner request loses ownership while waiting.

---

## 9. Test Environment Identity and Safety

| Item | Value |
|---|---|
| New datadir | `/tmp/s1-mixed-20261119` |
| MariaDB version | 11.8.6-MariaDB |
| TCP port | **3318** |
| Socket | `/tmp/s1-mixed-20261119/run/mysqld.sock` |
| Database | `absensi_s1_verify_mixed20261119` |
| Admin test user | `s1_mixed` |
| Runtime test user | `s1_mixed_app` |
| Guard | `S1_TEST_DB_GUARD=1` with explicit name/host/port |
| Test env file | `/tmp/s1-mixed-20261119/test.env`, mode **600** |
| Tables after migration | 12 (plus `_prisma_migrations`) |
| Seeded permissions | 27 |
| App connection proof | `DATABASE() = absensi_s1_verify_mixed20261119`, `@@port = 3318` |

Safety:

- No connection was made to port **3306** or **3307**.
- The previous `/tmp/s1-verify-20261119` environment was not modified.
- Migration was executed only with the explicit test URL.
- The app test user has DML on 11 tables and `SELECT, INSERT` only on `audit_logs`.
- The server was shut down cleanly after testing; port 3318 is closed.
- The datadir and `test.env` were preserved for evidence, not deleted.

---

## 10. S1-D10 through S1-D16 Results

| Test | Scenario | Iterations | Result |
|---|---|---:|---|
| **S1-D10** | PATCH `VIEWER→ANALYST` vs transfer to the same target | **50** | **PASS** — transfer succeeded 50/50; latest full-suite PATCH 39 success / 11 rejected; final owner always exactly 1; target always sole owner; former owner always admin |
| **S1-D11** | PATCH target T1 vs transfer to T2 | **50** | **PASS** — PATCH 50/50 and transfer 50/50; T1 analyst; T2 sole owner; former owner admin |
| **S1-D12** | Two concurrent transfers from same owner | **50** | **PASS** — exactly one success and one `409 OWNERSHIP_CHANGED` per iteration; owner count 1 |
| **S1-D13** | Last-owner protection and failed-operation immutability | 1 | **PASS** — `409 LAST_OWNER_PROTECTED`; self transfer `400`; assignment set unchanged |
| **S1-D14** | Controlled failure after ownership writes | 1 | **PASS (transaction semantics)** — target roles, actor roles, and owner state roll back; see limitation in §15 |
| **S1-D15** | PATCH same role on a target Owner | 1 | **PASS** — rejected `403 OWNERSHIP_TRANSFER_REQUIRED`; second owner's assignments and two-owner state unchanged |
| **S1-D16** | Ordinary no-op policy and authorization | 1 | **PASS** — viewer without `role.manage` rejected `403 FORBIDDEN`; admin peer no-op rejected `403 ROLE_HIERARCHY_VIOLATION`; admin→viewer same-role no-op returned `changed:false` with assignments unchanged |

D10 result counts are scheduler-dependent. The latest full-suite run recorded 39 PATCH successes and 11 authorization/conflict rejections; the targeted run recorded 37/13. All 50 transfer operations succeeded and all 50 final states were valid.

---

## 11. Existing S1-D1 through S1-D9 Regression

All existing tests passed in the final full auth suite:

- S1-D1: owner assignment through role change rejected.
- S1-D2: hierarchy and last-owner behavior preserved.
- S1-D3: admin can still assign a lower role.
- S1-D4: invitation owner/equal-role restrictions preserved.
- S1-D5: transfer moves exactly one owner and audits.
- S1-D6: non-owner/self/inactive/existing-owner transfer errors preserved.
- S1-D7: two concurrent transfers produce one owner and one conflict.
- S1-D8: cross-tenant transfer rejected without writes.
- S1-D9: transaction rollback preserved.

No existing security assertion was removed or weakened.

---

## 12. Concurrency Iteration Counts

| Coverage | Iterations | Operations |
|---|---:|---:|
| S1-D7 existing transfer race | 1 | 2 transfers |
| S1-D10 same-target PATCH/transfer | 50 | 100 operations |
| S1-D11 different-target PATCH/transfer | 50 | 100 operations |
| S1-D12 concurrent transfers | 50 | 100 operations |

Total mixed/concurrent test operations in the expanded coverage: **302**.

Each iteration queried the final database state and asserted the ownership invariant.

---

## 13. Exact Commands and Exit Codes

Environment for DB commands:

```bash
set -a; . /tmp/s1-mixed-20261119/test.env; set +a
```

S-1.1 commands actually executed:

| Command | Exit | Relevant result |
|---|---:|---|
| `npm run build --workspace @absensi/auth` | 0 | Auth dist rebuilt |
| `npm run typecheck --workspace @absensi/auth` | 0 | No TS errors |
| `node --test --test-force-exit --test-concurrency=1 dist/workspaces.test.js` | 0 | **28/28 PASS** |
| `node --test --test-force-exit --test-concurrency=1 dist` (auth) | 0 | **73/73 PASS** |
| Target verification through isolated test env | 0 | `absensi_s1_verify_mixed20261119`, port **3318** |
| `mariadb-admin ... ping` on isolated socket | 0 | `mysqld is alive` |

Database/web/permissions suites and the root `npm run typecheck` were **not rerun in S-1.1** because S-1.1 changed only auth source/tests and the report. Their prior results remain 21/21, 2/2, 9/9, and exit 0. No migration was executed in S-1.1.

Auth 73 includes **71 source test cases + 2 `dist` module artifacts** (`test-support.d.ts/.js`). The targeted workspaces file has 28 source tests. These artifacts are not independent test cases.

### Intermediate validation failures (not hidden)

1. First historical targeted run: **24/26**, D7/D12 expected `OWNERSHIP_CHANGED` but got `FORBIDDEN` because permission revalidation ran before stale-ownership detection.
2. Second historical targeted run: **25/26**, D6 expected `ALREADY_OWNER` but stale-ownership precheck returned `OWNERSHIP_CHANGED`.
3. Historical final targeted run: **26/26 PASS**.
4. S-1.1 targeted run: **28/28 PASS**, including S1-D15 and S1-D16.

No existing expected result was changed in S-1.1; no assertion was weakened.

---

## 14. Security Review Findings

- Both owner-mutating services use the same workspace lock.
- Lock is acquired before mutable membership/role reads.
- Authorization is revalidated with fresh actor/target roles and permissions.
- `deleteMany` is restricted to role IDs read under the lock.
- Transfer revalidates target status/roles and actor sole ownership after the lock.
- Exactly one owner is checked after transfer; at least one owner is checked after ordinary role change.
- Lock order is consistent and documented.
- No alternate application path grants/removes owner:
  - `createWorkspace()` and bootstrap create the initial owner for a new workspace.
  - `inviteMember()` stores an invitation role, not a member role.
  - Test support seeds roles only in tests.
  - No accept-invitation, member-delete, or leave endpoint exists yet.
- No-op PATCH now passes through `evaluateRoleChange()` before returning `changed:false`; an owner-targeted no-op is rejected by ownership policy, while an allowed ordinary no-op remains a no-op.
- Audit remains outside the transaction and best-effort; no authorization depends on it.
- No raw unsafe SQL was added; the lock query is a parameterized tagged query with explicit tenant ID.
- Error compatibility was checked against D6/D7/D12.

**Residual security risk:** there is no database constraint enforcing exactly one owner; any future code path that directly mutates `member_roles` without this lock can bypass the protocol. Future invitation acceptance, member deletion, and leave flows must use the same lock order.

---

## 15. Remaining Risks and Limitations

1. **S1-D14 is not a service-level fault injection test.** It uses the same real transaction, lock, and write sequence inside `withTenant().$transaction()`, but the failure is thrown by the test. The service's successful path is covered by D5/D7/D10/D11/D12.
2. **No DB-level owner constraint.** The invariant depends on application locking.
3. **Legacy multi-owner data.** Transfer rejects pre-state with more than one owner; role change can reduce an owner count but does not clean all legacy rows.
4. **Audit best-effort.** A transfer can commit if audit writing fails (TD-S1-V1).
5. **Coarse workspace lock.** Role mutations in the same workspace serialize; acceptable for low-volume admin operations but a throughput trade-off.
6. **No HTTP handler tests.** Route-level status/body behavior is still not directly exercised (TD-S1-V2).
7. **Future paths.** Accept invitation, delete/leave member, and any new role mutation must adopt the same lock order.
8. **Old-code reproduction.** The race is a source-analysis finding; this run did not execute the old implementation to reproduce it.

---

## 16. Final Git Status

HEAD remains `47e77c0527a4510c23d31017e78feaacdd978fd2` on `main`.

Existing baseline changes remain present. Files touched by **S-1.1**:

```text
 M packages/auth/src/workspaces.ts
 M packages/auth/src/workspaces.test.ts
?? docs/PHASE-2-SECURITY-S1-MIXED-CONCURRENCY-REMEDIATION-REPORT.md
```

`packages/database/src/index.ts` remains a shared file from Unit 2A and the mixed checkpoint, but was not touched by S-1.1. The tracked files were already part of the working-tree changes before this checkpoint; their existing content was preserved and extended. No unrelated file was staged or committed.

---

## 17. HEAD and Branch After Implementation

```text
HEAD:   47e77c0527a4510c23d31017e78feaacdd978fd2
Branch: main
```

No commit, amend, rebase, reset, checkout, stash, clean, or push was performed.

---

## 18. Confirmation: No Commit or Push

- No `git add`.
- No `git commit`.
- No `git push`.
- No branch change.
- No staging of the report or code.

The working tree still contains all prior Phase 1/2A/S-1/verification work plus this remediation.

---

## 19. Confirmation: No Migration, Schema, or `.env` Changes

- No repository migration file was added or edited.
- No `schema.prisma` change.
- No `.env` or `.env.example` change.
- No dependency or framework upgrade.
- The only migration executed was M1 against the **new isolated test database** at port 3318.
- The old verification database `/tmp/s1-verify-20261119` was not modified.
- The test environment datadir and `test.env` were preserved; the server was stopped.
