# Checkpoint 2B-0 — Deployment & Runtime Topology Verification

- **Date:** 2026-11-19
- **Repository:** `/home/reksa/absen-solusi/app`
- **Mode:** Read-only architecture verification
- **Implementation status:** Not started
- **Final verdict:** **TOPOLOGY NOT VERIFIED**

---

## 1. Git Baseline and Working-Tree Status

| Item | Verified value |
|---|---|
| Branch | `main` |
| HEAD | `ab9bc0cd7e0edfa93448b3cb297d472bc488c9ef` |
| Staged changes | 0 |
| Unstaged changes | 1 — `docs/PROJECT-CURRENT-STATE-AUDIT.md` |
| Untracked before this report | 7 Phase 2/3 report documents |
| Untracked after this report | 8, including this report |
| Source/test/schema/migration/package changes | None |

The only file created by this checkpoint is:

`docs/PHASE-2-CHECKPOINT-2B-0-DEPLOYMENT-TOPOLOGY-REPORT.md`

No implementation, migration, dependency installation, service start/stop, database connection, staging, commit, or branch operation was performed.

### Audit hygiene note

An initial broad repository grep unintentionally included `.env` and emitted a single non-secret configuration key (`TRUST_PROXY`). No credential, password, token, or connection-string value was printed. The local `.env` is not used as evidence in this report; all configuration conclusions below rely on `.env.example`, source code, package scripts, repository files, and observed process/port state.

---

## 2. Verified Application Runtime

### 2.1 Framework and start path

| Item | Finding | Evidence |
|---|---|---|
| Web framework | Next.js `16.4.6`, App Router, Node.js runtime | `apps/web/package.json:6-20`; `apps/web/src/app/**/route.ts` |
| Development command | `next dev` | `apps/web/package.json:7` |
| Build command | `next build` | `apps/web/package.json:8` |
| Production command | `next start` | `apps/web/package.json:9` |
| Custom server | None found | No server entry point outside Next.js route files |
| Next config | Empty configuration object | `apps/web/next.config.ts:1-5` |
| Standalone output | Not configured | No `output: "standalone"` |
| Cluster/worker config | None in the web application | No `cluster`, PM2, or worker setup found |
| Root start script | None | Root `package.json` has build/typecheck/test/Prisma scripts only |

`next start` is the only declared production start path. The repository does not launch multiple web processes by itself.

This establishes the **default process shape**, not the deployed topology. `next start` can be invoked more than once manually, by a process supervisor, by a container orchestrator, or by a platform. Those deployment mechanisms are not present in the repository.

### 2.2 Worker application

`apps/worker` is a placeholder, not a long-running job service:

- `apps/worker/src/index.ts:1-13` logs one startup line and exits.
- `apps/worker/package.json:6-10` defines `start: node dist/index.js`.
- No loop, queue consumer, scheduler, or database connection exists.

It does not serve HTTP requests and therefore does not add an application request-handling process today.

---

## 3. Verified Process, Worker, and Replica Topology

### 3.1 Observed state at audit time

| Check | Observed result |
|---|---|
| Next.js application process | None found |
| `next start` / `next-server` / `apps/web` process | None found |
| Listener on `3000`, `3001`, or `8080` | None |
| Nginx master | Running, PID 1220 |
| Nginx workers | 8 worker processes; master PID 1220 |
| MariaDB | Running, PID 1031, listening on `127.0.0.1:3306` |
| Public HTTP listener | `0.0.0.0:80` and `[::]:80` |

The Nginx worker count is a **reverse-proxy** worker count. It is not evidence of eight Next.js application instances.

### 3.2 Deployment manifests

No project deployment manifest was found:

- No `Dockerfile`
- No `docker-compose*` or `compose*.yml`
- No Kubernetes manifests
- No `Procfile`
- No PM2 `ecosystem.config.*`
- No project systemd unit
- No `vercel.json`, `fly.toml`, `render.yaml`, or `netlify.toml`
- No `.github/workflows`
- No Nginx/Caddy configuration inside the repository

Therefore the following are **not verified**:

- Number of production web processes
- Whether a cluster module or process manager is used
- Whether multiple replicas can serve requests concurrently
- Whether the platform is serverless, containerized, VM-based, or a managed Next.js host
- Whether a health check or readiness probe controls rolling deployment

### 3.3 What can and cannot be concluded

**Verified:** The project ships a default single-process `next start` command and contains no repository-level scaling configuration.

**Not verified:** That production actually runs exactly one web process. A single-process script is not a deployment guarantee. No running application was available to inspect, and no deployment manifest or supervisor configuration exists in the repository.

---

## 4. Verified Reverse-Proxy Topology

| Item | Finding |
|---|---|
| Reverse proxy | Host-wide Nginx is running |
| Proxy workers | 8 |
| Listener | Port 80 on all IPv4/IPv6 interfaces |
| Project vhost/upstream config | Not present in repository |
| App listener behind proxy | Not observed; no app on 3000/3001/8080 |
| Whether proxy overwrites or appends XFF | Unknown; configuration not in repository |
| Whether app port is publicly reachable | Currently no app listener; deployment binding unknown |
| Network isolation | Not verifiable from repository or available project configuration |

Nginx is clearly active on the host, but its site configuration, upstream block, `proxy_set_header` directives, TLS termination, and access controls are outside the repository and were not inspected. It is not valid to infer that Nginx forwards to this Next.js application, nor that it forwards to exactly one upstream.

A host-wide Nginx process is not evidence of application horizontal scaling. Equally, the absence of a project Nginx config is not evidence that only one app process exists.

---

## 5. `TRUST_PROXY` Findings

### 5.1 Documentation

`.env.example` currently documents only:

- `DATABASE_URL`
- `NODE_ENV`

`TRUST_PROXY` is **not documented** in `.env.example`.

### 5.2 Source behavior

A source-only search found **no** `TRUST_PROXY` reference in:

- `packages/auth/src`
- `packages/database/src`
- `apps/web/src`

The existing IP extraction is unconditional:

```ts
// packages/auth/src/http.ts:117-125
export function getClientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  const realIp = request.headers.get("x-real-ip")?.trim();
  return realIp || "unknown";
}
```

Consequences:

- The **leftmost** `X-Forwarded-For` value is trusted.
- A direct client can supply that header and choose its apparent IP.
- `X-Real-IP` is accepted as a fallback.
- There is no trusted-proxy flag, peer check, rightmost-address parsing, or header rejection.
- If neither header is present, every such request shares the literal key `unknown`.

No deployment configuration in the repository sets `TRUST_PROXY`. Whether an external supervisor or hosting platform sets it is unknown, and setting it currently has no effect because source does not read it.

---

## 6. Existing Rate-Limiter Behavior

### 6.1 Storage and lifetime

`MemoryRateLimiter` stores buckets in a `Map`:

- `packages/auth/src/rate-limit.ts:21-27` documents the limiter as in-memory per process and uses `private readonly buckets = new Map<string, Bucket>()`.
- `packages/auth/src/rate-limit.ts:60-68` creates one module-level `sharedLimiter` per Node.js process.
- `setLoginRateLimiter()` replaces that singleton, primarily for test injection.

Therefore:

- Buckets are shared only inside one JavaScript process.
- Separate Node processes, workers, containers, or replicas have independent counters.
- A process restart clears all counters.
- A hot reload in development can also reset counters.

### 6.2 Fixed-window semantics

`consume()` at `packages/auth/src/rate-limit.ts:29-53`:

1. Reads the bucket for the key.
2. Creates a new bucket with count 1 if absent or expired.
3. Rejects when `current.count >= limit`.
4. Otherwise increments the count.

This is a fixed window, not a sliding window or token bucket. Exactly `limit` requests are allowed; the next request in the same window is rejected. `retryAfterSeconds` is rounded up to at least one second.

### 6.3 Concurrency behavior

`consume()` is declared `async`, but its read-modify-write body contains no `await`. Within a single Node.js event loop, one call runs its synchronous body without interleaving with another call. That makes individual bucket updates effectively atomic **within one process**.

It does not provide:

- Atomicity across processes
- A shared quota
- Protection against several replicas each allowing the full limit
- A database-level conditional update or Redis-style atomic increment

### 6.4 Expiry and memory behavior

Expiry is lazy:

- An expired bucket is replaced only when the same key is consumed again.
- There is no periodic sweep or maximum bucket count.
- Unique keys remain in the `Map` until the process restarts or `clear()` is called.

This matters for multi-bucket workspace limits. Keys containing user IDs, tenant IDs, invitation tokens, or IP addresses can grow without bound. The current login limiter has only IP and account keys, but a generic multi-bucket design would increase cardinality substantially.

### 6.5 Multiple buckets

The class accepts arbitrary string keys, so it can support multiple independent buckets in one process. `enforceLoginRateLimit()` already uses two keys per attempt:

```ts
login:ip:${ip}
login:account:${email.toLowerCase()}
```

See `packages/auth/src/rate-limit.ts:84-117`.

The implementation therefore supports multiple buckets **structurally**, but not shared quotas across processes.

### 6.6 Fail-closed behavior and response semantics

`enforceLoginRateLimit()` catches a storage error and returns HTTP `503` with a 60-second retry value (`packages/auth/src/rate-limit.ts:94-105`). That wrapper is fail-closed.

However:

- `loginWithPassword()` converts the outcome into `HttpError` (`packages/auth/src/users.ts:168-178`).
- The login route catches it through `handleRouteError()` (`apps/web/src/app/api/auth/login/route.ts:25-47`).
- `HttpError` carries only `status`, `code`, and `message` (`packages/auth/src/http.ts:7-19`).
- `errorResponse()` emits only a JSON body and content type (`packages/auth/src/http.ts:21-30`).
- `handleRouteError()` does not add headers (`apps/web/src/lib/api.ts:3-7`).

As a result, the existing login `429` response does **not** include `Retry-After`, even though the limiter computes `retryAfterSeconds`. A future generic workspace limiter must explicitly preserve and emit that header.

### 6.7 Current login policy

The login route uses the shared limiter with:

- 10 attempts per 15 minutes per IP
- 10 attempts per 15 minutes per normalized account

Source: `packages/auth/src/rate-limit.ts:16-17`, `:84-117`.

This policy is process-local and has the same multi-process limitation described above.

---

## 7. Evidence Index

| Evidence | Location |
|---|---|
| Production start command | `apps/web/package.json:6-10` |
| Next.js version | `apps/web/package.json:18` |
| Empty Next config | `apps/web/next.config.ts:1-5` |
| Worker placeholder | `apps/worker/src/index.ts:1-13` |
| Worker scripts | `apps/worker/package.json:6-10` |
| Process-local comment and Map | `packages/auth/src/rate-limit.ts:21-27` |
| Fixed-window implementation | `packages/auth/src/rate-limit.ts:29-53` |
| Module-level singleton | `packages/auth/src/rate-limit.ts:60-68` |
| Login buckets and fail-closed wrapper | `packages/auth/src/rate-limit.ts:84-117` |
| XFF leftmost parsing | `packages/auth/src/http.ts:117-125` |
| Login rate-limit throw | `packages/auth/src/users.ts:168-178` |
| Login route error handling | `apps/web/src/app/api/auth/login/route.ts:25-47` |
| Error response has no retry header | `packages/auth/src/http.ts:21-30`; `apps/web/src/lib/api.ts:3-7` |
| Documented environment keys | `.env.example` |
| No deployment manifests | Repository file search; no Docker/Compose/K8s/PM2/systemd/CI/proxy files |
| Nginx master and 8 workers | Observed process table during audit |
| No Next app process or app-port listener | Observed process and listener table during audit |
| Port 80 public listener | Observed `ss` output during audit |

---

## 8. Unknown or Unverified Deployment Details

The following remain unknown and must not be invented:

1. Whether production runs one Next.js process or multiple processes.
2. Whether process clustering, PM2, systemd, Docker, Kubernetes, or another supervisor is used.
3. Whether multiple application replicas can serve requests simultaneously.
4. Whether the application is deployed as a managed/serverless platform or a long-lived Node server.
5. The Nginx site configuration, upstream target, load-balancing method, and `proxy_set_header` behavior.
6. Whether Nginx overwrites or appends `X-Forwarded-For`.
7. Whether application port 3000 is bound only to loopback, a private network, or a public interface in production.
8. Whether the host firewall or network policy isolates the app from direct public access.
9. Whether a deployment sets `TRUST_PROXY`; source currently ignores it regardless.
10. Whether restarts, rolling deploys, or autoscaling occur during normal operation.
11. Whether all request-serving code runs in the same Node process as the rate limiter.
12. Whether the Nginx host is the actual production ingress or an unrelated host service.

The application was not running during the audit, so no live request path, process count, or proxy behavior could be measured.

---

## 9. Rate-Limiter Recommendation

### Option A — In-memory, only if single-instance is verified

**Status: not justified by current evidence.**

The code is process-local, and the deployed process count is unverified. Approving Option A on the basis of “no Redis dependency exists” would conflate an absent dependency with a deployment guarantee. The repository contains no such guarantee.

Option A becomes acceptable only after all of the following are true:

- Production is explicitly restricted to one web process.
- No PM2 cluster mode, container replicas, or autoscaling is enabled.
- The single process is the only request-serving process for the relevant routes.
- Restart behavior and counter reset are documented as accepted limitations.
- The deployment contract is verified outside the repository.

### Option B — Shared storage, if multiple workers or instances are possible

**Required if horizontal scaling or multiple web processes are possible.**

A shared limiter would need:

- Atomic increment-and-expiry semantics.
- A shared key namespace for IP, account, user, tenant, and token buckets.
- Fail-closed behavior when the shared store is unavailable.
- A bounded retention policy for old buckets.
- `Retry-After` propagation at the HTTP boundary.

This checkpoint does not select or add Redis, a database table, or any other dependency. That is a separate product/architecture decision.

### Option C — Deployment restriction to a single process

**Recommended interim path only as an explicit, enforceable deployment contract.**

The project currently has a natural single-process start command (`next start`) and no repository-level cluster configuration. A Phase 2 restriction could therefore be operationally simple:

- Exactly one `next start` process serves the web application.
- No PM2 cluster mode, container replicas, or multi-instance platform scaling.
- Nginx, if used, has exactly one application upstream for these routes.
- The app port is not directly public.
- Restart resets are accepted and documented.
- The restriction is verified during deployment, not assumed from the absence of Redis.

However, **the restriction is not currently enforced or verified**. There is no startup guard, deployment manifest, or supervisor configuration in the repository. Option C is therefore a conditional recommendation, not a finding that the system is single-instance.

### Recommendation

Do **not** implement the generic workspace limiter on Option A yet.

1. If the product owner accepts a strict single-process Phase 2 deployment, approve **Option C**, publish the deployment contract, and verify the one-process/one-upstream condition before implementation.
2. If single-process cannot be guaranteed, approve **Option B** and select shared storage before implementing quotas.
3. In either case, preserve fail-closed behavior and add `Retry-After` at the HTTP boundary.
4. Bound bucket cardinality or add expiry cleanup before using per-user, per-tenant, and per-token keys.

---

## 10. Security Risks and Operational Limitations

### Security risks

| Risk | Impact | Current condition |
|---|---|---|
| Per-process counters | Each process allows its own full quota | Unverified process count; no shared store |
| XFF spoofing | IP buckets and audit IP attribution can be evaded | Leftmost XFF trusted unconditionally |
| Shared `unknown` IP bucket | All clients without headers can block one another | `getClientIp()` returns `unknown` |
| Restart reset | Attackers can regain quota after restart | In-memory state only |
| Unbounded bucket map | Memory growth from unique IP/user/token keys | No eviction or sweep |
| Missing retry header | Clients cannot back off correctly | `429` path drops `retryAfterSeconds` |
| Direct app exposure | XFF trust and IP limits become attacker-controlled | App binding and firewall unverified |
| Nginx upstream ambiguity | Multiple app backends would fragment quotas | Project proxy config absent |

### Operational limitations

- No live application process was available for verification.
- No deployment, supervisor, container, or platform manifest exists in the repository.
- Nginx is running host-wide, but its project-specific configuration is external.
- `TRUST_PROXY` is neither documented in `.env.example` nor read by source.
- The worker package is a one-shot placeholder, not a scalable job runtime.
- The in-memory limiter has no observability for bucket count, rejections, or resets.
- No E2E or multi-process test was found to prove quota behavior across workers.

---

## 11. Final Verdict

# **TOPOLOGY NOT VERIFIED**

The repository proves only that:

- The web application uses Next.js and declares `next start`.
- There is no repository-level clustering, container, supervisor, or proxy configuration.
- The only observed reverse proxy is a host-wide Nginx with eight proxy workers.
- No Next.js application process was running during the audit.
- The rate limiter is process-local and is not safe to treat as a global quota.

The repository does **not** prove that production runs exactly one application process. Therefore:

- **SINGLE-INSTANCE VERIFIED** is not supportable.
- **MULTI-INSTANCE VERIFIED** is also not supportable.
- **TOPOLOGY NOT VERIFIED** is the accurate verdict.
- In-memory rate limiting remains **conditional**, not approved as globally safe.

---

## 12. Recommended Next Checkpoint

**Checkpoint 2B-0A — Topology decision and deployment contract**

The product owner should choose one:

1. **Option C:** approve and document a strict single-process Phase 2 deployment, including one Nginx upstream and no replicas/autoscaling; or
2. **Option B:** approve a shared rate-limit store and define its operational requirements.

Only after that decision should **Checkpoint 2B-1** implement:

1. `TRUST_PROXY` default-deny behavior and rightmost-XFF handling.
2. Generic workspace rate limiting with fail-closed semantics and `Retry-After`.
3. Unit 2B invitation acceptance and revocation/list APIs.
4. Task 2.6 supporting APIs and UI.

No implementation, migration, service change, or configuration change is authorized by this report.

**STOP — awaiting explicit approval of the topology decision.**
