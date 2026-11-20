# Phase 2 — Final Security Audit

**Date:** 2026-11-19  
**Scope:** Committed Phase 1 shell, Unit 2A read/readiness work, and S-1/S-1.1 security changes  
**Unit 2B:** NOT IMPLEMENTED; no new endpoint or service exists to assess  
**Verdict:** **NOT APPROVED for Phase 2 completion**

---

## 1. Executive Result

The committed S-1 and S-1.1 changes close the previously critical role-escalation and ownership-race paths. Tenant isolation, CSRF, session validation, audit redaction, and role hierarchy have passing tests.

Two High findings remain open and are material:

- **S-3:** workspace creation, invitation, and role-change routes have no per-user rate limiting.
- **S-4:** `X-Forwarded-For` is trusted without a proxy allowlist; `TRUST_PROXY` is not read by source.

Unit 2B was not implemented because its identity, API-contract, and rate-limit-policy decisions are unresolved. No security claim is made for code that does not exist.

No Critical regression was found in the committed code.

---

## 2. Controls Verified

| Control | Result | Evidence |
|---|---|---|
| Password hashing | PASS | Argon2id test B1 |
| Session absolute/idle expiry | PASS | B9, B10 |
| Session revocation/rotation | PASS | B11, B12 |
| CSRF cookie-mode enforcement | PASS | B7, C5 |
| Bearer mode separation | PASS | B8 |
| RBAC permission matrix | PASS | C1–C4 |
| Role hierarchy and last-owner protection | PASS | S1-1–S1-11, S1-D1–D6 |
| Ownership transfer locking | PASS | S1-D5–D12 |
| No-op owner policy | PASS | S1-D15, S1-D16 |
| Cross-tenant isolation | PASS | D5, D7, L1, L4, T1–T9 |
| Tenant-scoped query extension | PASS | T1–T9 |
| Audit metadata redaction | PASS | E1–E2, F3–F5 |
| Readiness without DB detail | PASS | K1, K2 |
| Route-policy completeness | PASS | H1–H6, web route scan |

### S-1 remediation result

- Role changes and ownership transfers share the same workspace lock.
- Actor and target memberships, roles, and permissions are re-read after locking.
- Role deletion uses only assignment IDs read under the lock.
- Transfer enforces exactly one owner.
- Owner-targeted no-op role changes are rejected by policy before the no-op return.
- Allowed ordinary no-op role changes remain no-ops.

No alternate production owner-mutation path exists in the committed tree: invitation roles are stored but not assigned; bootstrap/workspace creation seeds only a new workspace’s initial owner.

---

## 3. Open Findings

### S-3 — High — Missing workspace rate limiting

**Affected paths:**

- `POST /api/workspaces`
- `POST /api/workspaces/:id/members`
- `PATCH /api/workspaces/:id/members/:memberId/role`

**Impact:** An authenticated user can spam workspace creation, invitations, or role changes, causing database growth and unnecessary load. Login rate limiting does not cover these routes.

**Status:** Open. Task 2.4 is not implemented.

**Required:** Approved quota/window policy, per-user/per-tenant buckets, fail-closed behavior, and `Retry-After` on 429.

### S-4 — High — Untrusted forwarded IP

**Affected code:** `packages/auth/src/http.ts::getClientIp()`.

`X-Forwarded-For` and `X-Real-IP` are accepted without checking a trusted proxy or the `TRUST_PROXY` setting. The audit found that `TRUST_PROXY` is not read in source.

**Impact:** IP-based login limiting and audit `ip_hash` can be spoofed when the application is directly exposed or the proxy chain is not constrained.

**Status:** Open. This must be resolved before claiming rate-limit completeness.

### S-14 — Medium/Low — Invitation token returned by API

`inviteMember()` returns the raw invitation token in its response. The token is hashed at rest and has a seven-day expiry, but there is no email delivery or accept endpoint in this tree.

**Impact:** Token exposure through clients/logs remains possible; invitations cannot be completed.

**Status:** Open until Task 2.2 and a delivery decision are approved. The raw token was not written to audit metadata.

### Audit integrity — known limitation

Audit writes are best-effort and occur after the transaction. A committed ownership change can succeed while its audit insert fails. No authorization decision depends on audit success.

### Ownership invariant — known limitation

The exactly-one-owner rule is application-level. No database constraint prevents a future code path from creating two owners or zero owners.

### HTTP-handler coverage — verification gap

Workspace routes lack direct handler tests. Policy and service tests pass, but request parsing, status codes, and response shape at the HTTP boundary are not proven.

### Legacy multi-owner data

No cleanup was performed. The code can find more than one owner in pre-existing data; it does not retroactively fix it.

---

## 4. Unit 2B Security Blockers

Unit 2B cannot pass a security review until these decisions are made:

1. **Invitee identity:** existing account only, or new-employee account/password activation.
2. **Accept contract:** endpoint, CSRF mode, success body, and exact invalid/expired/reused/email-mismatch statuses.
3. **Rate-limit policy:** quotas, windows, per-tenant limits, and in-memory/shared-store expectations.
4. **Proxy trust:** how `TRUST_PROXY` and trusted peers are enforced.
5. **UI/office settings:** Task 2.6 acceptance contract and Task 2.7 schema/timezone/work-hours approval.

The proposed accept flow would introduce a token-bearing public-to-authenticated operation. Without decisions 1–3, implementing it would invent security behavior.

---

## 5. Security Verdict

**NOT APPROVED for Phase 2 completion.**

The committed S-1 and S-1.1 code is a material improvement and has no known Critical regression. However, S-3 and S-4 remain High and open, Unit 2B is blocked, and Phase 2 UI/office requirements are unresolved.

No security issue in this report is silently accepted. No Unit 2B code, route, or migration was created.
