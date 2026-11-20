# Phase 2 Unit 2B — Requirements & Decision Report

**Date:** 2026-11-19  
**Status:** **BLOCKED — DECISIONS REQUIRED**  
**Implementation:** **NOT IMPLEMENTED**  
**Scope under review:** Task 2.2 accept invitation and Task 2.4 per-user workspace rate limiting  
**Baseline commits:** `61e1398` (Phase 1 web shell), `ab9bc0c` (Phase 2 read APIs and security)

---

## 1. Decision

Unit 2B cannot be implemented safely from the current approved documents without inventing product or security policy.

The documents propose a shape for 2.2 and 2.4, but they do not resolve:

1. whether an invitation is only for an existing authenticated user or must create/activate a new employee account;
2. the approved accept-invitation endpoint, request/response contract, and exact error semantics;
3. exact rate-limit quotas, windows, route buckets, and multi-instance storage expectations;
4. the Phase 2 UI and office-settings scope;
5. approval for the office-settings schema/migration.

Under the master execution rules, this is a STOP condition: **Unit 2B requirements are ambiguous**.

No Task 2.2 or 2.4 source change, route, migration, or test was created.

---

## 2. Evidence Used

- `docs/PHASE-2-NEXT-CHECKPOINT.md` — proposed 2B scope and open decisions.
- `docs/PROJECT-CURRENT-STATE-AUDIT.md` — Task 2.2/2.4 gaps and Phase 2 deliverable.
- `docs/NEXT-EXECUTION-PLAN.md` — Unit 2A boundaries and exclusions.
- `docs/PHASE-1.md` — invitation token storage/lifecycle.
- `packages/auth/src/workspaces.ts` — `inviteMember()`.
- `packages/auth/src/rate-limit.ts` — login limiter.
- `packages/auth/src/http.ts` — session, CSRF, `requirePermission()`, `getClientIp()`.
- `packages/database/prisma/schema.prisma` — invitation, membership, role, and session models.
- Existing tests and route registry.

---

## 3. Proposed Functional Scope

This section is a plan only. It is not an approved contract.

### 3.1 Task 2.2 — Accept invitation

Proposed behaviour:

- Accept a raw invitation token from the invitee.
- Hash the token with SHA-256 and find the matching `workspace_invitations.token_hash`.
- Require `status = PENDING` and `expiresAt > now`.
- Require an authenticated session whose normalized email equals the invitation email.
- In one transaction:
  - lock the workspace row using the existing role-mutation lock order;
  - create or activate the `workspace_member` row;
  - assign the invitation role;
  - set invitation `status = ACCEPTED` and `accepted_at`;
  - enforce the membership uniqueness constraint;
  - write `member.accept` audit after the transaction.
- If the session has no active tenant, set `active_tenant_id` to the invitation workspace.
- If the session already has an active tenant, do not silently switch it.
- Never log or audit the raw token or token hash.

### 3.2 Task 2.4 — Workspace rate limiting

Proposed behaviour:

- Generic limiter keyed by `userId + route + bucket` for authenticated workspace actions.
- Fail closed if the limiter backend errors.
- Return `429` with `Retry-After` when the limit is reached.
- Apply at minimum to:
  - `POST /api/workspaces`;
  - `POST /api/workspaces/:id/members`;
  - `PATCH /api/workspaces/:id/members/:memberId/role`.
- Keep the in-memory implementation unless a shared store is approved; document the single-instance limitation.
- Add DB-free tests for window reset, bucket isolation, fail-closed behavior, and Retry-After.

---

## 4. Proposed API Contract

**This table is not approved.**

| Item | Proposed value |
|---|---|
| Method/path | `POST /api/invitations/accept` (path explicitly marked “or approved contract” in the source recommendation) |
| Authentication | Existing session, cookie or Bearer |
| CSRF | Required for cookie mode; Bearer mode follows existing rule |
| Permission | None beyond authenticated session; email match is the authorization check |
| Body | `{ "token": "<raw invitation token>" }` |
| Success | Membership summary, role keys, workspace summary; exact shape TBD |
| Invalid/unknown token | `404` without revealing invitation existence |
| Expired token | `410` or `404` — **undecided** |
| Already accepted | `409` or `410` — **undecided** |
| Email mismatch | `403` or `404` — **undecided** |
| Already a member | `409` — proposed |
| No active tenant | Set active tenant to accepted workspace |
| Existing active tenant | Preserve; do not switch silently |

The status ambiguity matters because it affects client UX, test assertions, and whether invitation existence leaks.

---

## 5. Authorization and Tenant Matrix

| Actor / request | Proposed result |
|---|---|
| No session | `401 UNAUTHENTICATED` |
| Session email differs from invitation email | Reject; exact status undecided |
| Session email matches, token valid, PENDING | Accept |
| Token valid but expired | Reject; exact status undecided |
| Token already accepted | Reject; preserve first accepted membership |
| Token belongs to tenant A, caller has no tenant A session | Token is the bearer secret; acceptance creates membership in tenant A only |
| Caller already member of tenant A | Reject duplicate; no role overwrite |
| Invitation role is Owner/higher than inviter | Existing invitation policy must remain in force; acceptance must not bypass it |
| Cross-tenant workspace ID supplied by client | Not accepted; tenant comes from the token’s invitation record |

### Tenant-isolation rule

The token hash lookup is necessarily a **SYSTEM** operation because no tenant context exists before the token is resolved. After resolving the invitation, all membership/role writes must run under a tenant context derived from the invitation’s `tenantId`, with the workspace row locked. The client must never choose the tenant.

---

## 6. Database Impact

### Task 2.2

**Class A — no migration required.**

The existing schema already has:

- `workspace_invitations.token_hash` unique;
- `status`, `expires_at`, `accepted_at`;
- composite foreign key `(tenant_id, role_id)` to `roles`;
- unique `(tenant_id, user_id)` on `workspace_members`;
- composite unique `(tenant_id, id)`.

A database constraint for “exactly one owner” is still absent; invitation acceptance must preserve the existing role policy and must not assign Owner outside the approved transfer flow.

### Task 2.4

**Class A — no migration required** for an in-memory limiter.

A shared/persistent limiter would require a new store or table and therefore a separate migration decision.

### Task 2.7

Not part of Unit 2B. Office settings likely require new schema and a migration; see `docs/PHASE-2-DATABASE-MIGRATION-READINESS.md`.

---

## 7. Security Considerations

- Raw invitation tokens are currently returned in the invite response (S-14). Acceptance must not add token logging, token audit metadata, or token echo.
- Token lookup must use a timing-safe/hash lookup; do not compare raw tokens in application code.
- Invalid/expired/accepted responses must not disclose invitation existence or email ownership.
- Email comparison must use `normalizeEmail()`.
- Acceptance must run in a transaction with the same workspace lock order used by role mutation and ownership transfer.
- The unique membership constraint and invitation status update must protect against concurrent double acceptance.
- Existing CSRF, session, and tenant checks remain mandatory.
- Rate limiting must fail closed; otherwise Task 2.4 creates a false sense of protection.
- `getClientIp()` currently trusts `X-Forwarded-For` without a proxy allowlist; rate limiting by IP cannot be considered trustworthy until this is resolved.

---

## 8. Test Strategy

### Task 2.2

- valid token + matching existing user → membership, role, `ACCEPTED`, audit;
- wrong email → no membership, no status change;
- malformed/unknown token → no membership, uniform response;
- expired token → no membership;
- already accepted token → one membership, second request rejected;
- concurrent double accept → exactly one membership and one role;
- invitation for another tenant → no cross-tenant membership;
- owner invitation remains rejected by existing policy;
- no raw token in audit/log output;
- active tenant set only when session has none;
- existing active tenant preserved.

### Task 2.4

- limiter window reset;
- independent user/route buckets;
- per-user and per-tenant isolation;
- fail-closed 503 on backend error;
- `429` with `Retry-After`;
- route handlers apply limiter before destructive work;
- database-free tests for limiter algorithm;
- DB tests proving no workspace/invite/role row is written when limited.

### HTTP verification gap

The current repository still lacks direct handler tests for workspace routes. Unit 2B must include handler-level tests, not only service tests.

---

## 9. Proposed Acceptance Criteria

- [ ] Approved endpoint/status contract is recorded before implementation.
- [ ] Invitee identity policy is approved (existing user only, or new-user onboarding).
- [ ] Valid invite acceptance creates exactly one membership and role.
- [ ] Invalid/expired/reused token cannot create or modify membership.
- [ ] Email mismatch is rejected without existence leakage.
- [ ] Acceptance is tenant-isolated and concurrency-safe.
- [ ] `member.accept` audit is written without any token/hash.
- [ ] Workspace POST/invite/role endpoints have per-user limiting.
- [ ] `429` includes `Retry-After`; limiter failure returns 503.
- [ ] No migration is introduced for 2.2/2.4.
- [ ] Existing tests and new tests pass against the isolated DB.
- [ ] `npm run typecheck`, suite tests, and build pass.
- [ ] Unit 2B report records real commands and exit codes.

---

## 10. Blocking Decisions

### B2B-1 — Invitee identity and account creation (Critical)

The recommendation requires an authenticated session with the same email, but the Phase 2 deliverable says employees activate accounts through invitations. The audit also notes there is no handling for new versus existing users.

**Impact:** An unregistered employee cannot accept an invitation. Implementing a session-only flow would satisfy the proposed 2.2 text but fail the stated Phase 2 deliverable. Implementing user creation/password setup would add an unapproved authentication and credential lifecycle.

**Required decision:** Choose one:

- **A. Existing users only:** invitation links an existing account; new-employee onboarding moves to a separate approved flow (recommended for a minimal safe Unit 2B).
- **B. New-employee activation:** define account creation, password setup, email ownership proof, session issuance, CSRF, and abuse controls before implementation.

### B2B-2 — Accept endpoint and error contract (High)

The document says “`POST /api/invitations/accept` (atau kontrak yang disetujui)” and leaves `403/404` and `409/410` open.

**Impact:** Cannot write stable handler tests, client code, or API documentation.

**Required decision:** Approve path, body, success shape, and exact statuses for invalid/expired/reused/email-mismatch cases.

### B2B-3 — Rate-limit policy (High)

The recommendation names keys and routes but not quotas, windows, per-tenant limits, or storage expectations.

**Impact:** A limiter can be built, but its security value and user impact cannot be reviewed against an approved policy.

**Required decision:** Approve per-route and per-tenant quotas/windows and whether in-memory single-instance behavior is accepted for this phase.

### B2B-4 — Phase 2 UI and office settings (High)

Task 2.6 lacks a detailed acceptance contract, and Task 2.7 requires unapproved product decisions and likely a migration.

**Impact:** Phase 2 cannot be marked complete even if 2B is implemented.

**Required decision:** Approve 2.6 scope and 2.7 schema/timezone/work-hours design, including migration authorization.

### B2B-5 — Proxy trust (High, existing)

`X-Forwarded-For` is trusted directly and `TRUST_PROXY` is not read by source. IP-based rate limiting and audit IP hashing are spoofable when the app is exposed without a trusted proxy.

**Required decision:** Define trusted-proxy behavior before claiming rate-limit completeness.

---

## 11. Recommended Minimal Path

If the product owner wants the smallest safe 2B:

1. Approve **existing-user-only** invitation acceptance.
2. Approve `POST /api/invitations/accept`, body `{ token }`.
3. Approve one consistent status policy:
   - `401` no session;
   - `404` unknown token;
   - `410` expired;
   - `409` already accepted;
   - `403` email mismatch (or a deliberately uniform `404`, if product prefers non-enumeration).
4. Preserve active tenant unless the session has none.
5. Implement 2.4 with explicit quotas and fail-closed behavior.
6. Defer new-employee account activation, 2.6 UI, and 2.7 office settings to separately approved checkpoints.

This recommendation is **not implemented** and requires approval.

---

## 12. Stop State

- Unit 2B: **NOT IMPLEMENTED**.
- Task 2.2: **NOT STARTED**.
- Task 2.4: **NOT STARTED**.
- Task 2.6: **NOT STARTED**.
- Task 2.7: **NOT STARTED**.
- No migration created or applied.
- No source/test file changed by this audit.
- No new commit created after the authorized Group A/B commits.

**STOP — product-owner decisions required.**
