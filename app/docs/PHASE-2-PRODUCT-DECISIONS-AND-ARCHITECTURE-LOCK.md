# Phase 2 — Product Decisions & Architecture Lock

**Date:** 2026-11-19
**Mode:** READ-ONLY analysis; this report is the only file created
**Repository:** `/home/reksa/absen-solusi/app`
**Branch:** `main`
**HEAD:** `ab9bc0cd7e0edfa93448b3cb297d472bc488c9ef`
**Final verdict:** **READY WITH LIMITATIONS**

---

## 1. Repository and Git Baseline

### Verified state

| Item | Value |
|---|---|
| Branch | `main` |
| HEAD | `ab9bc0cd7e0edfa93448b3cb297d472bc488c9ef` |
| Staged files | 0 |
| Unstaged modified | 1: `docs/PROJECT-CURRENT-STATE-AUDIT.md` (prior addendum) |
| Untracked before this report | 6 prior reports |
| Untracked after this report | 7 (the six prior reports plus this report) |
| Source/test/schema/env changes in this audit | none |
| Database connections in this audit | none |
| Migration executed in this audit | none |
| Commit/staging performed in this audit | none |

The existing unstaged and untracked files were preserved. This audit did not run tests, open a database connection, or change environment files.

### Scope

This report resolves the five open Phase 2 areas:

1. invitation acceptance and new-employee activation;
2. workspace rate limiting;
3. trusted proxy / client IP handling;
4. Task 2.6 workspace/member UI;
5. Task 2.7 office settings.

It does not implement, migrate, commit, or begin Phase 3.

### Evidence inspected

- `packages/auth/src/workspaces.ts`
- `packages/auth/src/rate-limit.ts`
- `packages/auth/src/http.ts`
- `packages/auth/src/users.ts`
- `packages/auth/src/session.ts`
- `packages/auth/src/password.ts`
- `packages/auth/src/role-policy.ts`
- `packages/permissions/src/index.ts`
- `packages/database/prisma/schema.prisma`
- `packages/database/prisma/migrations/20261118090000_m1_foundation/migration.sql`
- All current `apps/web/src/app/api/**/route.ts`
- Existing web pages/components
- Existing tests and Phase 2 reports

The historical report `docs/PROJECT-CURRENT-STATE-AUDIT.md` says some Phase 2 tasks were not started; that was true when written. The current tree has Unit 2A and S-1 committed, but still has no accept-invitation route, no workspace rate limiting, no member UI, and no office settings.

---

## 2. Verified Current Architecture

### 2.1 Authentication and session

- Cookie and Bearer modes share one session store.
- Session token is random 32 bytes, stored as SHA-256; absolute TTL 7 days, idle 24 hours.
- CSRF is double-submit for cookie mode; Bearer mode bypasses CSRF by design.
- Login rate limit is **10 attempts / 15 minutes per IP and per account**, in-memory and fail-closed.
- `getClientIp()` currently uses the **leftmost** `X-Forwarded-For` value, then `X-Real-IP`, else `"unknown"`.
- `TRUST_PROXY` is present in environment discussion but is **not read by source**.

### 2.2 Workspace and invitation data

- `workspace_invitations` stores email, role ID, unique token hash, status, expiry, inviter, accepted timestamp.
- `inviteMember()` creates a 32-byte raw token, stores SHA-256, returns the raw token once, and sets a 7-day expiry.
- Invite creation rejects existing active members and pending unexpired invitations.
- No accept route, no revocation route, no pending-invitation list, and no email delivery exist.
- `workspace_members` is unique on `(tenant_id, user_id)`.
- `member_roles` is keyed by `(tenant_id, member_id, role_id)`.
- There is no database constraint enforcing exactly one owner.

### 2.3 Role and permission model

- Roles: `WORKSPACE_OWNER`, `WORKSPACE_ADMIN`, `AFFILIATE_MANAGER`, `BUSINESS_DEVELOPMENT`, `ANALYST`, `VIEWER`.
- Owner has all 27 permissions.
- Admin has all except `workspace.manage`.
- Viewer, Analyst, Affiliate Manager, and Business Development have `member.read` but not invite/role management.
- Role-change and transfer policies are enforced server-side; the UI must not be the authority.

### 2.4 Existing routes

```text
GET  /api/health
GET  /api/health/ready
GET  /api/auth/csrf
POST /api/auth/login
POST /api/auth/logout
GET  /api/auth/me
POST /api/auth/register
GET  /api/workspaces
POST /api/workspaces
GET  /api/workspaces/:id/members
POST /api/workspaces/:id/members
PATCH /api/workspaces/:id/members/:memberId/role
POST /api/workspaces/:id/ownership/transfer
```

### 2.5 Verified gaps relevant to this decision

| Gap | Evidence |
|---|---|
| No invitation accept endpoint | No `invitations` route exists |
| No invitation revoke/list endpoint | Only `inviteMember()` create path exists |
| No active-workspace switch endpoint | Session `activeTenantId` is set at login and never updated by an API |
| No role catalog endpoint | UI would have to hardcode role keys/labels |
| `/api/auth/me` has no active permission list | It returns user, active tenant, and workspace role keys only |
| No workspace settings model/API/UI | `Workspace` has only name, slug, status, timestamps |
| No UI for members/invites/settings | Only landing, sign-in, and sign-out exist |
| Workspace POST does not update active tenant | New workspace is created but session remains on old tenant |
| No generic rate limiter | `enforceLoginRateLimit()` is login-specific |
| No trusted-proxy allowlist | `getClientIp()` trusts headers unconditionally |

---

## 3. Decision Matrix

| Area | Recommended decision | Why | Approval needed |
|---|---|---|---|
| Invitation identity | **Hybrid:** existing user must be logged in and email-matched; a new user is created only through a valid invitation token with name/password | Satisfies employee activation while preventing takeover of an existing account | Yes — token possession is not mailbox verification |
| Invitation contract | `POST /api/invitations/accept`; token in body; 404 unknown, 410 expired/revoked, 409 accepted, 403 email mismatch, 401 login required for existing account | Clear, testable client behavior without putting tokens in query logs | Yes — status policy |
| Invitation lifetime | Keep 7 days; single-use; add `REVOKED` status and revoke endpoint | Existing DB supports it without a migration; admin needs a kill switch | Yes |
| Rate limiting | Generic per-user/per-tenant fixed windows; in-memory for Phase 2; fail-closed | Reuses tested limiter semantics; prevents the High S-3 abuse path | Yes — quotas and single-instance limit |
| Proxy trust | Default `TRUST_PROXY=false`; when enabled, trust only the **rightmost** syntactically valid XFF address behind a network-isolated overwrite/append proxy | Fixes leftmost spoofing without requiring a new dependency; deployment peer CIDR remains a network control | Yes — deployment profile |
| Task 2.6 UI | Four screens plus three supporting APIs: session switch, workspace roles, invitation list/revoke | Current APIs cannot support a complete UI without these | Yes — scope |
| Task 2.7 settings | One `workspace_settings` row per workspace with nullable IANA timezone, office/address text, workday bitmask, local-minute hours, grace period | Additive, supports Phase 3 timezone/geofence later without pre-creating locations | Yes — schema and defaults |
| Office locations/geofencing | Defer coordinates/radius/polygons to Phase 3; no `office_locations` in 2.7 | Avoids inventing geofence product requirements now | Yes |

---

## 4. Recommended Options and Rationale

### 4.1 Invitation acceptance

#### Recommended flow

One public route:

```text
POST /api/invitations/accept
```

Body:

```json
{
  "token": "<raw invitation token>",
  "name": "Nama Karyawan",
  "password": "minimum-12-characters"
}
```

`name` and `password` are required only when the invitation email has no existing `User`. They are rejected or ignored for an existing user; see below.

**Case A — existing user**

1. Look up the invitation by SHA-256 token hash.
2. Find the `User` by normalized invitation email.
3. Require a valid session. No session returns `401 LOGIN_REQUIRED`.
4. Session email must match the invitation email. Mismatch returns `403 INVITATION_EMAIL_MISMATCH`.
5. Verify invitation is PENDING, unexpired, and not revoked.
6. Lock the workspace row, re-check invitation state, create/activate membership, assign the invitation role, mark invitation ACCEPTED, and audit `member.accept`.
7. If the session has no active tenant, set it to the accepted workspace. If it already has one, do not silently switch.

**Case B — no existing user**

1. Look up the invitation and verify it is PENDING/unexpired.
2. Create an ACTIVE user with the invitation email and the supplied name/password.
3. Create membership and role, mark invitation ACCEPTED, and audit.
4. Issue a new session for the new user with the accepted workspace as active tenant.
5. For web cookie mode, set the session and CSRF cookies; for Bearer mode, return the session token.

**Case C — existing user but no valid session**

Do not create a new account and do not reset the password. Return `401 LOGIN_REQUIRED`; the client should send the user to sign-in, then retry acceptance.

#### Email ownership

The repository has no email delivery or email-verification infrastructure. Therefore:

- Existing-user acceptance proves account access through login.
- New-user acceptance proves possession of the high-entropy invitation token, **not mailbox control**.
- The token must be delivered through a trusted channel by the inviter.
- If the product requires mailbox ownership proof, new-account activation must wait for an email provider/verification flow (Phase 6 or a separately approved addition).

This is a limitation to approve explicitly. It should not be described as “verified email.”

#### Token security

- Keep 32 random bytes / base64url, 256-bit entropy.
- Store only SHA-256; lookup by hash.
- Never log or audit raw tokens or token hashes.
- Use an invitation link fragment, e.g. `/invitations/accept#token=<token>`, so the token is not sent in the initial HTTP request or server access log.
- Read the fragment client-side and submit it in the POST body.
- Set `Cache-Control: no-store` for the accept page/API.
- Rate-limit acceptance by IP and token hash.
- Enforce one-time use; never allow an accepted token to add a second membership.

#### Expiry, reuse, revocation

Recommended status policy:

| Condition | HTTP | Code |
|---|---:|---|
| Unknown/malformed token | 404 | `INVITATION_NOT_FOUND` |
| Expired token | 410 | `INVITATION_EXPIRED` |
| Revoked token | 410 | `INVITATION_REVOKED` |
| Already accepted | 409 | `INVITATION_ALREADY_ACCEPTED` |
| Email mismatch on existing account | 403 | `INVITATION_EMAIL_MISMATCH` |
| Existing account, no session | 401 | `LOGIN_REQUIRED` |
| Account inactive | 403 | `ACCOUNT_INACTIVE` |
| Membership already exists | 409 | `ALREADY_MEMBER` |
| New account race lost | 409 | `ACCOUNT_EXISTS_LOGIN_REQUIRED` |
| Invalid password | 400 | `INVALID_PASSWORD` |

Keep the existing 7-day TTL. Add a `REVOKED` status and an admin revoke endpoint rather than shortening the TTL without product approval. Expired invitations may remain `PENDING` and be rejected by the expiry check; optionally mark `EXPIRED` for reporting.

#### Transaction and concurrency safety

- Resolve the token hash through `systemDb()` because no tenant context exists yet.
- Use the existing workspace-row lock order: workspace → membership → member_roles.
- Re-read invitation state after acquiring the lock.
- Use the unique `(tenant_id, user_id)` constraint as the final duplicate guard.
- For new users, handle unique-email/P2002 by returning `ACCOUNT_EXISTS_LOGIN_REQUIRED`; never overwrite an existing password.
- Audit after commit, consistent with current best-effort behavior; do not make audit failure grant membership.

#### Supporting invitation APIs

Recommended for a complete 2.2 and 2.6:

```text
GET    /api/workspaces/:id/invitations
DELETE /api/workspaces/:id/invitations/:invitationId
```

- Both require `member.invite` (or a future `member.manage`).
- GET returns email, role key, status, expiry, created time; never token/hash.
- DELETE sets `REVOKED`; only PENDING invitations can be revoked.
- Tenant claim and workspace lock apply.
- Audit `member.invite_revoke`.

---

### 4.2 Workspace rate limiting

#### Recommended architecture

Add a generic limiter alongside `MemoryRateLimiter`:

```text
enforceRateLimit({
  keys: [userKey, tenantKey],
  limit,
  windowMs,
  now
})
```

- Preserve fail-closed behavior: backend error returns 503, never allow.
- Use fixed windows to match the existing login limiter and make tests deterministic.
- Add `Retry-After` to 429 responses.
- Do not reveal remaining quota.
- Apply limits before any mutation and before expensive queries.
- Keep a process-local limiter for Phase 2; document that it is not a global quota across instances.

#### Recommended quotas

These are concrete starting values, not verified production capacity:

| Action | Bucket | Limit | Window |
|---|---|---:|---:|
| Create workspace | `workspace.create:user:<userId>` | 5 | 60 min |
| Invite member | `workspace.invite:user:<userId>` | 30 | 60 min |
| Invite member | `workspace.invite:tenant:<tenantId>` | 100 | 60 min |
| Change role | `workspace.role:user:<userId>` | 60 | 60 min |
| Change role | `workspace.role:tenant:<tenantId>` | 200 | 60 min |
| Transfer ownership | `workspace.transfer:user:<userId>` | 10 | 60 min |
| Transfer ownership | `workspace.transfer:tenant:<tenantId>` | 20 | 60 min |
| Accept invitation | `invitation.accept:ip:<ip>` | 20 | 60 min |
| Accept invitation | `invitation.accept:token:<tokenHash>` | 10 | 60 min |
| Bootstrap register | `auth.register:ip:<ip>` | 5 | 60 min |

Rationale:

- Workspace creation provisions six roles and the full permission catalog; it is the most expensive normal user action.
- Invitation creation is the main spam/DB-growth path.
- Role changes are administrative but can be automated; 60/hour permits bulk cleanup while requiring a human pace.
- Ownership transfer is rare and high-impact; a tight limit is appropriate.
- Acceptance is one-time per token but may be retried; the token bucket prevents token probing and accidental duplicate submissions.
- Per-tenant limits prevent a compromised admin account from exhausting the entire workspace’s operation budget.

#### Tenant isolation

- Tenant bucket IDs come only from the authenticated session context.
- Never use a workspace ID supplied in the URL as the rate-limit tenant.
- Workspace creation has no tenant bucket; it uses the authenticated user.
- Rate limiting must not become an authorization decision; return 403/404 from the actual authorization path when applicable.

#### Storage decision

- **Phase 2 recommendation:** in-memory, single process, matching current deployment assumptions.
- **Limitation:** multiple Next workers/instances have independent buckets; restart resets limits.
- **Before horizontal scale:** replace with a shared store (Redis or equivalent) behind the same interface; a database table is possible but introduces contention and cleanup work.
- No new dependency is approved by this report.

---

### 4.3 Trusted proxy and client IP

#### Current behavior

`getClientIp()`:

1. returns the leftmost `X-Forwarded-For` value;
2. otherwise returns `X-Real-IP`;
3. otherwise returns `"unknown"`.

There is no trusted-peer check. A direct client can spoof either header.

#### Recommended policy

**Default (`TRUST_PROXY` unset or `false`)**

- Ignore `X-Forwarded-For` and `X-Real-IP`.
- Return `null`/unknown for the client IP.
- Do not consume an IP rate-limit bucket when the IP is unknown; rely on account/user/tenant buckets.
- Store no audit IP hash when unknown.

**Opt-in (`TRUST_PROXY=true`)**

Only supported with this deployment contract:

- The app is bound to loopback/private network and reachable only through the reverse proxy.
- The proxy overwrites or appends `X-Forwarded-For`; it does not pass a client-supplied chain through untouched.
- The app uses the **rightmost syntactically valid IPv4/IPv6 address**, which is the address added by the immediate proxy. Do not use the leftmost value.
- `X-Real-IP` is used only if `X-Forwarded-For` is absent, and only with the same trust assumption.
- Invalid/multiple/ambiguous values become unknown; do not fall back to a spoofable value.
- The proxy’s network access is restricted by firewall/security group to the app port.

**Not supported in this phase**

- Multiple proxy hops with a CIDR allowlist enforced inside the app.
- Direct public exposure with `TRUST_PROXY=true`.

Next.js `Request` does not expose the raw socket peer in the route handler. A true in-app peer-CIDR allowlist would require a custom Node server or platform-level control. The recommended network boundary is therefore an operational requirement, not something the current handler can verify alone.

#### Consequences

- Login rate limiting should always use the account bucket; the IP bucket is an additional layer only when the IP is trusted.
- Audit `ip_hash` is best-effort attribution, not proof of source when `TRUST_PROXY=false`.
- Add `TRUST_PROXY` to `.env.example` with a secure default and explanation; do not silently enable it.
- Add tests for: default ignores spoofed headers; trusted mode uses rightmost; invalid header becomes unknown; direct mode never returns attacker-supplied IP.

---

### 4.4 Task 2.6 — Workspace/member UI

#### Current capability gap

The UI currently has only landing, sign-in, and sign-out. It cannot switch workspace, list members, invite, change roles, transfer ownership, view pending invitations, or manage settings.

#### Recommended screens

**1. `/` — workspace home**

- Active workspace name, slug, role(s), sign-out.
- Workspace selector for users with multiple memberships.
- Create-workspace form when permitted.
- Links to Members, Pending Invitations, and Settings based on permissions.
- Empty state when no workspace exists.
- 401 redirects to `/sign-in`; inactive/forbidden workspace explains the state.

**2. `/workspaces/[id]/members` — member management**

- Paginated member table: name, email, status, roles, joined date.
- Invite form: email, role; token displayed once as a copyable acceptance link (no email delivery yet).
- Pending invitation list with expiry and revoke action.
- Role change control, disabled for self/owner or when policy forbids it.
- Ownership transfer action with explicit confirmation and target selection.
- Empty/loading/error/conflict states.
- Pagination uses the existing `limit`/`offset` contract.

**3. `/invitations/accept` — public acceptance page**

- Reads token from the URL fragment, not the query string.
- Existing users are prompted to sign in and then return to acceptance.
- New users provide name/password.
- Never displays the token in the page body, logs, or analytics.
- Shows expiry/revoked/accepted/mismatch states with safe recovery actions.

**4. `/workspaces/[id]/settings` — Task 2.7**

- Office name/address, timezone, workdays, work hours, break, grace period.
- Read-only for members without `workspace.manage`.
- Validation and save confirmation; no settings API exists yet.

#### Supporting APIs required

| API | Purpose | Permission |
|---|---|---|
| `PATCH /api/auth/session` | Switch `activeTenantId` after validating active membership | authenticated session |
| `GET /api/workspaces/:id/roles` | Role labels, rank, assignability for selectors | `member.read` |
| `GET /api/workspaces/:id/invitations` | Pending/history list | `member.invite` |
| `DELETE /api/workspaces/:id/invitations/:invitationId` | Revoke pending invitation | `member.invite` |
| Extend `GET /api/auth/me` | Add active-workspace `permissions` for UI gating | authenticated session |

`POST /api/workspaces` should either set the new workspace active when the user has none, or the UI must call the session-switch API immediately after creation. The second behavior should be explicit, not accidental.

#### RBAC behavior

- Use server-returned permissions for action visibility, never role-name guesses alone.
- Hide invite/role controls when the permission is absent; still handle server 403.
- Owner-only: ownership transfer and settings write.
- Admin: invite and role management where policy allows.
- Viewer/Analyst/Affiliate Manager/Business Development: read-only member list unless future policy changes.
- A member may not change their own role; the UI must disable it.
- A last owner cannot be demoted; the API remains authoritative.

#### UI engineering constraints

- Use the existing Next.js/React stack; no new UI framework or state library is required.
- Prefer server components for reads and small client components for mutations.
- Keep current inline-style conventions or introduce a small CSS module; do not add a design system.
- Use accessible labels, `aria-live` for errors, disabled/busy states, and a confirmation dialog for destructive/high-impact actions.
- No browser/E2E infrastructure currently exists. Add handler tests and a documented manual smoke checklist; add Playwright only if separately approved.

---

### 4.5 Task 2.7 — Office settings

#### Recommended model

Create one workspace-owned settings row, not a new global configuration table:

```text
workspace_settings
- tenant_id (PK, FK workspaces.id)
- office_name (nullable, varchar 120)
- address_line (nullable, varchar 255)
- city (nullable, varchar 120)
- timezone (nullable, IANA varchar 64)
- workdays (nullable int bitmask, bits 1=Mon ... 7=Sun)
- work_start_minute (nullable int, 0..1439)
- work_end_minute (nullable int, 0..1439)
- break_start_minute (nullable int)
- break_end_minute (nullable int)
- late_grace_minutes (default 0)
- updated_by_user_id (nullable, FK users.id)
- created_at / updated_at
```

Why this shape:

- One row per workspace keeps 2.7 small and tenant-scoped.
- Nullable fields avoid inventing defaults or destructive backfills.
- Minutes from local midnight avoid timezone/date serialization ambiguity.
- A bitmask is compact and deterministic; the API exposes an array of ISO weekdays.
- A separate `office_locations` table is deferred to Phase 3, where geofence coordinates/radius/polygons belong.

#### Time and timezone rules

- Store IANA timezone names, never numeric offsets (`Asia/Jakarta`, not `+07:00`).
- Validate with `Intl.DateTimeFormat(undefined, { timeZone })`.
- Store timestamps in UTC; interpret work hours in the configured timezone.
- Workday bits use ISO weekdays 1–7.
- `start == end` should be rejected; `end < start` means an overnight shift.
- Break times must be both present or both absent; validate against the work period.
- Existing workspaces remain unconfigured (`null`) until an owner saves settings. Phase 3 attendance must block or flag unconfigured schedules rather than assume a timezone.

#### API

```text
GET   /api/workspaces/:id/settings
PATCH /api/workspaces/:id/settings
```

GET:

- Permission: `workspace.read` or `member.read` (all active members can see schedule).
- Tenant claim and `withTenant`.
- Returns nullable/unconfigured fields, not fabricated defaults.

PATCH:

- Permission: `workspace.manage` (owner) for Phase 2.
- Body uses ISO weekday arrays and `HH:mm` strings; server converts to minutes.
- Validates timezone, workdays, ranges, break pairing, grace period.
- Writes audit `workspace.settings.update` with changed field names, not secrets.
- Returns the saved settings.

If administrators should manage office settings without ownership, that requires a new permission/role decision; do not silently reuse `workspace.manage` for non-owners.

#### Migration implications

- Additive table only; no column drops or data rewrite.
- Existing workspaces need no row or can have a row with nullable settings.
- **Class B** for isolated verification, **Class C** for applying to a shared development/production environment because it changes schema and requires product approval.
- No migration is created or applied by this report.
- Phase 3 `office_locations`/geofence migration remains separate.

---

## 5. Security Implications

### Invitation

- A high-entropy, single-use token is the invitation secret; it must never be logged or put in a query string.
- New-account activation by token possession does not prove mailbox ownership. This is the main security limitation of the recommended Phase 2 flow.
- Existing-account acceptance must require a session with matching email; a token must never be able to reset or replace an existing password.
- Use Argon2id and the existing 12–128 character password policy; map `PasswordPolicyError` to 400.
- Uniform handling of invalid tokens should avoid unnecessary account/invitation enumeration.
- Revocation is required so an administrator can invalidate a leaked or misdelivered link.
- The workspace lock and unique membership constraint prevent double membership; they do not replace role policy.
- Audit must never contain raw token, token hash, password, or session token.

### Rate limiting

- Fail closed; a backend outage must not open mutation routes.
- Rate-limit keys use session-derived user/tenant IDs, not URL tenant IDs.
- In-memory limits are not global across instances; do not claim otherwise.
- `Retry-After` is required for 429; do not expose remaining quota.
- Acceptance rate limiting must not itself become an account-enumeration oracle.

### Proxy

- Default-deny header trust is the secure baseline.
- `TRUST_PROXY=true` without a network-isolated proxy is unsafe; the configuration must be documented as a deployment contract.
- Leftmost XFF is spoofable; use the rightmost address added by the immediate proxy.
- IP-based limits are supplementary; account/user/tenant limits remain mandatory.
- Audit IP hashes are not trustworthy attribution when proxy trust is disabled.

### UI

- Do not store tokens in `localStorage`; use fragments only for entry and clear them after read where practical.
- React escaping is the default; do not inject invite emails/tokens with `dangerouslySetInnerHTML`.
- Server-side authorization remains authoritative; hiding a button is not authorization.
- Confirmation is required for ownership transfer; show irreversible/high-impact consequences.
- 429 responses must show a retry time, not silently retry in a loop.
- No analytics or error reporting may capture invite URLs/tokens.

### Office settings

- Validate timezone/ranges server-side; do not trust browser timezone detection.
- All settings reads/writes go through `withTenant`.
- Owner-only writes until a new permission is approved.
- Audit changes without leaking free-text addresses if policy later classifies them as sensitive.

---

## 6. Database / Schema / Migration Implications

| Change | Class | Notes |
|---|---|---|
| Invitation acceptance (existing user) | **A — no migration** | Existing invitation/member/role tables suffice |
| Invitation acceptance (new user) | **A — no migration** | `users` and password fields already exist; user creation is application logic |
| Invitation `REVOKED` status | **A — no migration** | `status` is varchar; no enum constraint |
| Invitation list/revoke APIs | **A — no migration** | Existing table has required fields |
| Generic rate limiting | **A — no migration** | In-memory; shared store would be later |
| Trusted proxy | **A — no migration** | Env/config/code only |
| Task 2.6 UI/APIs | **A — no migration** | Uses existing tables; session update is an existing column |
| Task 2.7 `workspace_settings` | **B/C — migration** | Additive table; isolated test in B, shared apply requires C approval |
| `office_locations`/geofence | **C — later Phase 3** | Not defined; do not create now |
| Exactly-one-owner DB constraint | **C — later** | Existing multi-owner data and migration policy unresolved |

No migration was run in this audit. `prisma/schema.prisma` and the migration directory were only read.

---

## 7. Proposed API Contracts

### 7.1 Accept invitation

```http
POST /api/invitations/accept
Content-Type: application/json
```

```json
{
  "token": "base64url-token",
  "name": "New Employee",
  "password": "12-or-more-characters"
}
```

- `name`/`password` required only for a new account.
- Existing accounts must have a cookie/Bearer session matching the invitation email.
- Cookie mode requires CSRF; Bearer mode follows existing rules.
- Success `200` for accepted existing account, `201` for newly created account.
- Response must not echo the raw invitation token.

### 7.2 Switch active workspace

```http
PATCH /api/auth/session
Content-Type: application/json
```

```json
{ "activeTenantId": "workspace-uuid" }
```

- Authenticated session; CSRF in cookie mode.
- Validate active membership in the target workspace.
- Update only the session’s `active_tenant_id`.
- Return the active workspace summary and permissions.
- Do not use this endpoint to grant roles or membership.

### 7.3 Roles

```http
GET /api/workspaces/:id/roles
```

Returns role key, label, rank, and whether the current actor may assign it. Read permission: `member.read`; no role mutation.

### 7.4 Invitations

```http
GET    /api/workspaces/:id/invitations
DELETE /api/workspaces/:id/invitations/:invitationId
```

- `member.invite`; tenant claim; no raw token/hash in responses.
- Revocation only for PENDING invitations.
- Audit `member.invite_revoke`.

### 7.5 Office settings

```http
GET   /api/workspaces/:id/settings
PATCH /api/workspaces/:id/settings
```

PATCH body:

```json
{
  "officeName": "Kantor Pusat",
  "addressLine": "Alamat",
  "city": "Jakarta",
  "timezone": "Asia/Jakarta",
  "workdays": [1, 2, 3, 4, 5],
  "workStart": "08:00",
  "workEnd": "17:00",
  "breakStart": "12:00",
  "breakEnd": "13:00",
  "lateGraceMinutes": 10
}
```

Server converts times to local minutes and validates all ranges. `workStart == workEnd` is invalid; overnight end before start is allowed.

### 7.6 Rate-limit response

```http
HTTP/1.1 429 Too Many Requests
Retry-After: 47
Content-Type: application/json
```

```json
{ "error": { "code": "RATE_LIMITED", "message": "Terlalu banyak permintaan; coba lagi nanti" } }
```

Limiter backend failure:

```json
{ "error": { "code": "RATE_LIMIT_UNAVAILABLE", "message": "Layanan pembatas tidak tersedia" } }
```

with HTTP 503.

---

## 8. Acceptance Criteria

### Invitation

- [ ] Existing user with matching session email accepts a valid pending token exactly once.
- [ ] Existing user without session receives 401; no account/password change occurs.
- [ ] Existing user with different email receives 403; no membership/role change occurs.
- [ ] New user with valid token, name, valid password gets one ACTIVE account and one membership with the invitation role.
- [ ] Invalid password returns 400 `INVALID_PASSWORD`, never 500.
- [ ] Unknown, expired, revoked, and accepted tokens return the approved status/code.
- [ ] Concurrent acceptance creates exactly one membership/role and one ACCEPTED transition.
- [ ] An existing account cannot be taken over with an invitation token.
- [ ] Active tenant is set only when the session has none; an existing active tenant is preserved.
- [ ] `member.accept` audit exists and contains no token/hash/password.
- [ ] No raw token appears in logs, query strings, or analytics.

### Rate limiting

- [ ] Each approved action returns 429 + `Retry-After` at its quota.
- [ ] Limiting occurs before mutation; no workspace/invite/role row is written when limited.
- [ ] Limiter backend error returns 503 and never allows the operation.
- [ ] User and tenant buckets are independent and correctly derived from session.
- [ ] Rate limits do not leak quota details or cross-tenant state.
- [ ] Single-instance limitation is documented and accepted.

### Proxy

- [ ] `TRUST_PROXY=false` ignores spoofed XFF/X-Real-IP.
- [ ] Trusted mode uses the rightmost valid proxy-added address.
- [ ] Invalid/ambiguous values fall back to unknown, not attacker-controlled input.
- [ ] Login and audit tests cover spoofed and direct requests.
- [ ] Deployment documentation states the network isolation requirement.

### Task 2.6

- [ ] User can list/switch workspaces; active tenant changes only after server validation.
- [ ] Member list paginates and preserves tenant isolation.
- [ ] Invite form creates an invitation and displays a one-time acceptance link.
- [ ] Pending invitations can be viewed and revoked.
- [ ] Role changes and ownership transfer show correct permission/self/owner restrictions.
- [ ] Unauthorized users see read-only or denied states; server still returns 403.
- [ ] Loading, empty, 401, 403, 404, 409, and 429 states are defined.
- [ ] No token is stored in localStorage or rendered through raw HTML.
- [ ] Handler tests cover status/body contracts; browser smoke checklist is documented.

### Task 2.7

- [ ] Owner can save valid office name/address/timezone/workdays/hours/break/grace.
- [ ] Invalid timezone, equal start/end, invalid weekdays, and malformed breaks return 400.
- [ ] Overnight shifts are represented and tested.
- [ ] GET/PATCH are tenant-isolated; non-owner cannot write.
- [ ] Audit records field changes without sensitive payloads.
- [ ] Migration is additive and tested only on an isolated database.
- [ ] Unconfigured settings do not silently receive a fabricated timezone.

### Phase 2 gate

- [ ] Unit 2B, 2.6, and 2.7 acceptance criteria pass.
- [ ] S-3 and S-4 are closed or explicitly accepted with approval.
- [ ] No Critical/High blocker remains without written acceptance.
- [ ] API handler tests and UI smoke verification exist.
- [ ] All migrations are reviewed, isolated-tested, and approved.
- [ ] Reports reflect actual commands and exit codes.

---

## 9. Dependencies and Implementation Sequence

1. **Approve this decision set** (especially B2B-1 email ownership and quotas).
2. **Proxy and environment foundation**
   - implement `TRUST_PROXY` default-deny behavior;
   - update `.env.example`;
   - add spoofing tests.
3. **Unit 2B**
   - invitation accept + revoke/list;
   - generic rate limiter and quotas;
   - password-policy error mapping;
   - handler tests and isolated DB tests.
4. **Unit 2.6 API prerequisites**
   - session active-workspace switch;
   - role catalog;
   - permissions in `/api/auth/me`;
   - invitation list/revoke.
5. **Unit 2.6 UI**
   - home/switcher;
   - members/invite/role/transfer;
   - accept page;
   - states and permission gating.
6. **Unit 2.7**
   - approve schema;
   - write additive migration;
   - isolate-test migration;
   - settings API + UI;
   - timezone/work-hours tests.
7. **Phase 2 integration and security gate**
   - full auth/database/web suites;
   - handler and browser smoke tests;
   - migration review;
   - update completion and Phase 3 readiness reports.

No Phase 3 code or migration is part of this sequence.

---

## 10. Remaining Questions Requiring Explicit Product-Owner Approval

1. **New employee activation:** approve hybrid acceptance where token possession creates a new account, with no mailbox verification until Phase 6? Or restrict Phase 2 to existing users only?
2. **Error semantics:** approve 404 unknown, 410 expired/revoked, 409 accepted, 403 email mismatch, 401 login required.
3. **Invitation management:** approve `GET`/`DELETE` pending invitation APIs and a `REVOKED` status.
4. **Rate quotas:** approve or replace the quota table in §4.2. Explicitly accept the in-memory single-instance limitation for Phase 2.
5. **Proxy deployment:** approve `TRUST_PROXY=false` by default and `TRUST_PROXY=true` only behind a network-isolated single proxy using rightmost XFF.
6. **Task 2.6 API additions:** approve session switching, role catalog, invitation list/revoke, and permissions in `/api/auth/me`.
7. **Task 2.6 UI scope:** approve the four screens, one-time invite-link display, and no new UI framework.
8. **Task 2.7 schema:** approve `workspace_settings`, nullable timezone/hours, bitmask workdays, owner-only writes, and deferral of office locations/geofencing to Phase 3.
9. **Phase 2 scope:** confirm 2.6 and 2.7 are required for Phase 2 completion, and whether UI browser smoke is manual or requires a new E2E dependency.
10. **Email delivery:** confirm Phase 6 email or an earlier separately approved provider; until then, invitation delivery remains manual.

---

## 11. Final Verdict

**READY WITH LIMITATIONS**

The five areas now have a concrete recommended architecture, API shape, acceptance criteria, migration classification, and implementation order. The recommendations are sufficient to approve and begin implementation.

The limitations are explicit:

- New-account activation by token does not prove mailbox ownership.
- In-memory rate limiting is not global across processes/instances.
- Trusted-proxy enforcement depends on network isolation and the rightmost-XFF deployment contract; Next.js `Request` does not expose the raw peer for an in-app CIDR check.
- Office settings deliberately defer multi-location/geofence schema to Phase 3.
- No browser/E2E infrastructure exists yet.

If the product owner approves the defaults in §10, implementation can proceed without inventing requirements. If mailbox verification is mandatory for new accounts, that single decision blocks new-employee activation until an email-verification flow is approved.

**STOP.** No implementation, migration, commit, or Phase 3 work was performed.
