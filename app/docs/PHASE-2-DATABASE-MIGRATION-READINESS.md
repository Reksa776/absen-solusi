# Phase 2 — Database Migration Readiness

**Date:** 2026-11-19  
**Database:** MariaDB 11.8.6  
**Schema source:** `packages/database/prisma/schema.prisma`  
**Migration inventory:** one existing migration, `20261118090000_m1_foundation`  
**Migration applied in this run:** **NONE**  
**Verdict:** **NO MIGRATION APPROVED**

---

## 1. Current Schema

The committed schema has 12 application models/tables:

```text
users
sessions
workspaces
workspace_members
roles
permissions
role_permissions
member_roles
workspace_invitations
audit_logs
background_jobs
background_job_attempts
```

The single existing migration creates those tables, keys, and indexes. The runtime database account is grant-limited; `audit_logs` is append-only for the application account.

Relevant invitation/membership constraints:

- `workspace_invitations.token_hash` is unique.
- `workspace_invitations` has composite FK `(tenant_id, role_id)`.
- `workspace_members` has unique `(tenant_id, user_id)`.
- `workspace_members` and `roles` have composite unique `(tenant_id, id)`.
- `member_roles` uses `(tenant_id, member_id, role_id)` as its primary key.

No database constraint enforces exactly one `WORKSPACE_OWNER` per tenant.

---

## 2. Proposed Change Classification

| Item | Classification | Reason |
|---|---|---|
| Task 2.2 accept invitation | **A — no migration** | Token hash, status, expiry, accepted time, membership uniqueness, and role FK already exist |
| Task 2.4 in-memory rate limiting | **A — no migration** | Process-local buckets; no persistence required |
| Task 2.4 shared persistent limiter | **B/C — migration required** | Needs an approved shared store/table and operational review |
| Task 2.6 UI only | **A — no migration** | Consumes existing APIs |
| Task 2.7 office settings | **C — migration required, approval needed** | Model, timezone, work-hours, permissions, API, and UI are undefined |
| DB constraint for exactly one owner | **C — migration required, approval needed** | Existing multi-owner data and migration strategy must be assessed |

---

## 3. Unit 2B Impact

### Task 2.2

No schema change is required for the proposed existing-user flow. The implementation would use existing columns and constraints.

**Important:** invitation acceptance must use the existing workspace lock order and must not assign Owner outside the approved invitation/transfer policy. A unique `(tenant_id, user_id)` constraint protects membership duplication, but it does not by itself protect role escalation.

### Task 2.4

No schema change is required for the current in-memory limiter. A multi-instance deployment cannot rely on that limiter; a shared store would require a separate approved migration.

---

## 4. Migration Gate Evidence

| Check | Result |
|---|---|
| `npm run prisma:validate` | exit 0 |
| Schema file changed in this run | no |
| New migration created | no |
| Migration applied to development DB | no |
| Migration applied to production DB | no |
| Migration applied to isolated test DB | no; existing schema reused |
| `.env` contents read | no |
| Development DB port 3307 contacted | no |
| System DB port 3306 contacted | no |
| Isolated test DB port 3318 | used only for existing tests; stopped afterward |

The test suite’s `resetDatabase()` ran only on the guarded isolated database `absensi_s1_verify_mixed20261119` at `127.0.0.1:3318`.

---

## 5. Task 2.7 Migration Decision

Task 2.7 is **not sufficiently defined** for a migration:

- office name/address fields;
- timezone representation and validation;
- work hours, breaks, holidays, and overnight shifts;
- whether settings are per workspace or per location;
- relationship to the future `office_locations` model;
- permissions and audit actions;
- API and UI contract;
- data migration and rollback strategy.

The audit’s own Phase 2 recommendation notes that 2.7 needs a separate migration approval and product decisions. No migration should be created until those are resolved.

---

## 6. Risks

1. **Owner invariant:** application-only enforcement can be bypassed by future direct writes.
2. **Concurrent acceptance:** unique membership constraint is necessary but error handling and transaction order still require tests.
3. **Legacy multi-owner data:** no cleanup is authorized; a future constraint migration must handle it.
4. **Audit failure:** audit writes are outside the transaction and best-effort.
5. **Shared limiter:** an in-memory limiter is not a global guarantee across instances.
6. **Timezone ambiguity:** Phase 3 geofence/attendance correctness depends on an approved timezone/work-hours model.

---

## 7. Verdict

**NO MIGRATION APPROVED.**

- Unit 2B, if later approved as existing-user-only + in-memory limiter, requires **no migration**.
- A shared limiter or Task 2.7 requires an approved migration plan and isolated verification.
- No schema or migration file was changed, and no database was migrated.
- Phase 2 cannot be marked complete until the remaining schema/product decisions are approved.
