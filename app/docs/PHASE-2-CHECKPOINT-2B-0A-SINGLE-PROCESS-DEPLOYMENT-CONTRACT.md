# Checkpoint 2B-0A — Single-Process Deployment Contract

- **Date:** 2026-11-19
- **Repository:** `/home/reksa/absen-solusi/app`
- **Mode:** Read-only audit and documentation
- **Implementation status:** Not started
- **Final verdict:** **CONTRACT DOCUMENTED — DEPLOYMENT NOT VERIFIED**

---

## 1. Product Owner Decision and Approved Scope

The product owner has approved **Option C** for Phase 2. The target deployment contract is:

1. Exactly one VPS serves the application.
2. Exactly one Next.js production process runs using `next start`.
3. Exactly one Nginx upstream points to that application process.
4. No PM2 cluster mode.
5. No Node.js cluster mode.
6. No additional application replicas.
7. No horizontal autoscaling.
8. The application port is not publicly accessible directly.
9. Nginx is the only permitted public HTTP entry point.
10. In-memory rate limiting is accepted for Phase 2 only under this restriction.

This is an approved target architecture. It is not evidence that the current host already satisfies it.

### Compliance Matrix

| # | Requirement | Current evidence | Status |
|---|---|---|---|
| 1 | One VPS | No production inventory, DNS, or deployment record identifies the intended VPS; this host is not confirmed as production | **NOT VERIFIED** |
| 2 | One Next.js production process | No Next.js process was running; no supervisor or deployment unit exists; zero observed | **NOT VERIFIED** |
| 3 | One Nginx upstream to the app | Nginx has no `proxy_pass` or `upstream` block; only a default web-root site | **FAIL on this host** |
| 4 | No PM2 cluster mode | PM2 is not installed; no PM2 configuration found | **VERIFIED on this host** |
| 5 | No Node.js cluster mode | No `cluster.fork`, cluster config, or cluster runtime found | **VERIFIED in repository** |
| 6 | No additional application replicas | No Docker/Podman runtime or application systemd unit; production inventory unknown | **NOT VERIFIED for production** |
| 7 | No horizontal autoscaling | No platform or deployment configuration was found; external platform unknown | **NOT VERIFIED** |
| 8 | App port not publicly accessible | `next start` is invoked without `-H`; Next.js defaults to `0.0.0.0`; no host firewall tools are installed | **FAIL for the declared start path** |
| 9 | Nginx is the only public HTTP ingress | Nginx listens on port 80; another public listener exists on port 7070; no host firewall tools are installed | **NOT VERIFIED** |
| 10 | In-memory limiter accepted under this contract | Product decision approved; technical operation depends on actually enforcing one process | **VERIFIED as policy; CONDITIONAL technically** |

The observed FAIL items are provisioning gaps that can be corrected. They do not prove the architecture is impossible. They do prove that the current environment does not yet satisfy Option C.

---

## 2. Git Baseline and Working-Tree State

| Item | Verified value |
|---|---|
| Branch | `main` |
| HEAD | `ab9bc0cd7e0edfa93448b3cb297d472bc488c9ef` |
| Staged changes | 0 |
| Unstaged changes | 1 — `docs/PROJECT-CURRENT-STATE-AUDIT.md` |
| Untracked before this report | 8 documents |
| Source/test/schema/migration/package changes | None |

This checkpoint creates only:

`docs/PHASE-2-CHECKPOINT-2B-0A-SINGLE-PROCESS-DEPLOYMENT-CONTRACT.md`

No source, test, schema, migration, package, environment, Nginx, systemd, PM2, or firewall configuration was modified. No service was started, stopped, or reloaded. No database was contacted. No Git staging or commit was performed.

The prior Checkpoint 2B-0 report correctly concluded that topology was not verified. This report converts the approved Option C target into a concrete contract and records the remaining gaps.

---

## 3. Host/VPS Identity Verification

Privacy-safe fingerprints:

| Item | Value |
|---|---|
| Machine ID fingerprint | `3af3619c10742e73` (truncated SHA-256) |
| Hostname fingerprint | `49073076a407307d` (truncated SHA-256) |
| Kernel/architecture | Linux `6.12.117+deb13-amd64`, `x86_64` |
| Virtualization detection | `none` |
| Node.js | `v26.13.0` |
| npm | `11.20.0` |
| Nginx | Installed and running |
| PM2 | Not installed |
| Docker | Not installed |
| Podman | Not installed |

No public IP address, hostname, domain, SSH key, credential, or unrelated personal data is reproduced here.

`systemd-detect-virt` reporting `none` does not prove this is a bare-metal host or the production VPS. It means no known virtualization signature was detected. The host may be a VPS, a development workstation, or another machine.

**Whether this machine is the intended production VPS is NOT VERIFIED.** There is no deployment inventory, DNS record, infrastructure manifest, or environment-specific deployment documentation in the repository that binds this host to production.

---

## 4. Actual Process Topology

### 4.1 Application processes

| Check | Result |
|---|---|
| `next-server`, `next start`, `apps/web`, `@absensi/web` processes | None |
| Listener on port 3000 | None |
| Listener on port 3001 | None |
| Listener on port 8080 | None |
| Application systemd unit | None found |

The application is currently **not running**. Therefore the requirement “exactly one application process” cannot be verified from a live process. The observed count is zero, which is not compliance with “exactly one.”

### 4.2 Process managers and orchestration

| Mechanism | Result |
|---|---|
| PM2 binary | Not installed |
| PM2 process | None |
| PM2 ecosystem/config file | None found |
| supervisord | None |
| forever | None |
| nodemon | None |
| Docker | Not installed |
| Podman | Not installed |
| Application systemd unit | None found |
| Kubernetes/autoscaling manifest | None found |

Only system-level services relevant to this host were observed: Nginx and Tailscale. Neither is the Next.js application.

### 4.3 Concurrency

The repository has no cluster mode, process fork, replica configuration, or autoscaling configuration. However, nothing currently prevents an operator from running a second `next start` process manually, on another port or after changing `PORT`.

This is an operational control gap, not proof of a safe single-process topology.

---

## 5. Nginx Server and Upstream Topology

### 5.1 Observed Nginx state

| Item | Result |
|---|---|
| Nginx master | Running, PID 1220 |
| Nginx workers | 8 worker processes |
| Public HTTP listener | `0.0.0.0:80` and `[::]:80` |
| Public HTTPS listener | None observed on 443 |
| Enabled site | Default site only |
| Application upstream | None |
| `proxy_pass` directives | None found |
| `upstream` blocks | None found |
| Relevant project vhost | None found |

The accessible Nginx configuration contains no reverse proxy to the Next.js application. The enabled default site is a web-root site with no application upstream.

### 5.2 Requirement assessment

The contract requires exactly one Nginx upstream pointing to the application process. The available host configuration has **zero** application upstreams.

This is a **FAIL on this host**, not merely an unverified item. If the intended production VPS is a different machine, its configuration remains **NOT VERIFIED**.

### 5.3 X-Forwarded-For behavior

No `proxy_set_header X-Forwarded-For` directive exists in the accessible Nginx configuration because there is no application proxy.

Therefore:

- Overwrite-versus-append behavior is **NOT APPLICABLE** to the current config.
- The required sanitized forwarding behavior is **NOT VERIFIED** for the target deployment.
- The application currently trusts the leftmost XFF value in source, which is incompatible with the approved trust model even if Nginx later proxies requests.

### 5.4 Nginx worker count

Nginx has one master and eight workers. This is normal proxy concurrency and is **not** an application replica count. It neither proves nor disproves the single-process application contract.

---

## 6. Public Ingress and Application-Port Exposure

### 6.1 Current listeners

| Port | Binding | Interpretation |
|---|---|---|
| 80 | `0.0.0.0` and `[::]` | Nginx public HTTP |
| 443 | None observed | No public TLS listener observed |
| 3000 | None | Next.js not running |
| 3001 | None | No listener |
| 8080 | None | No listener |
| 7070 | `0.0.0.0` and `[::]` | Another public listener; protocol/purpose not identified |

The public listener on 7070 prevents a positive verification of “Nginx is the only public HTTP entry point.” It may or may not be HTTP, but that was not determined without probing an unrelated service.

### 6.2 Application binding

The declared production command is:

```text
next start
```

It does not specify `-H` or `--hostname`.

The installed Next.js 16.4.6 CLI documents the default hostname as `0.0.0.0`:

- `apps/web/package.json:9` — `"start": "next start"`
- `node_modules/next/dist/bin/next:229` — start option: hostname default `0.0.0.0`
- `node_modules/next/dist/cli/next-start.js` — passes `options.hostname` to the server without adding a loopback default

If started exactly as currently declared, the application will listen on all interfaces, not only loopback. That violates requirement 8 unless an external firewall or security group blocks port 3000.

### 6.3 Firewall

No `ufw`, `nft`, or `iptables` binary was found. Host-level firewall rules could not be inspected or verified. A cloud security group, upstream network policy, or router ACL may exist outside this host, but no evidence was available.

**Status: FAIL for the declared start path; external blocking NOT VERIFIED.**

---

## 7. Production Startup and Restart Contract

This is a proposed operating procedure. It was not executed.

### 7.1 Preconditions

- The approved production host is identified and recorded.
- The built artifact exists from a successful production build.
- No existing Next.js production process is serving the app.
- No listener exists on the chosen application port.
- Nginx has exactly one upstream for the app.
- The application port is blocked from public ingress.
- `TRUST_PROXY` policy is settled, even though implementation is pending.

### 7.2 Pre-start verification

Before starting, verify:

```text
pgrep -af 'next-server|next start'    # must show no application process
ss -ltn 'sport = :3000'               # must show no listener
```

If either check shows an existing instance, stop and investigate rather than starting another.

### 7.3 Proposed start command

The current `next start` script must not be used unchanged if requirement 8 is to hold. The target command should bind to loopback explicitly:

```text
cd /home/reksa/absen-solusi/app
npm run build --workspace @absensi/web
npm run start --workspace @absensi/web -- -H 127.0.0.1 -p 3000
```

This is a target command, not an executed command. The package script currently lacks the `-H 127.0.0.1` argument.

### 7.4 Post-start verification

Verify all of the following:

```text
pgrep -af 'next-server|next start'    # exactly one application process
ss -ltn 'sport = :3000'               # one listener, bound to 127.0.0.1:3000
```

Also verify:

- Nginx has exactly one application upstream.
- A request through Nginx reaches the app.
- A direct request to the app port from another host fails.
- Only Nginx is publicly reachable for HTTP.
- The application health endpoint responds through Nginx.

### 7.5 Restart

1. Identify the exact application PID; do not use a broad process-name kill.
2. Send `SIGTERM` to that process.
3. Wait until the process exits and the application port is closed.
4. Confirm no second process or listener exists.
5. Start exactly one replacement process with the loopback binding.
6. Repeat the post-start verification.
7. Record that all in-memory rate-limit counters were reset.

No overlapping old/new process is permitted.

### 7.6 Deployment

- Build into a separate artifact location, or accept downtime: stop the old process before rebuilding in place.
- Do not rewrite `.next` under a live production process.
- Stop the old process cleanly.
- Verify zero listeners.
- Start one new process.
- Verify one process and one listener.
- Do not perform blue/green, canary, rolling, or replica-based deployment.
- Do not use PM2 cluster mode or Node cluster mode.
- Do not let a supervisor or deployment script launch a second instance.
- Fail the deployment operationally if a second application process or listener is detected.

### 7.7 Enforcement status

No executable enforcement currently exists. Manual commands and operator discipline are the only controls. A future systemd unit or pre-start guard script could enforce a single PID and a loopback binding, but creating it is outside this checkpoint and would require approval.

---

## 8. `TRUST_PROXY` Requirements

The approved policy is:

- `TRUST_PROXY=false` by default.
- `TRUST_PROXY=true` only when the application is reachable exclusively through the approved Nginx reverse proxy.
- Nginx must overwrite or correctly append forwarded headers according to the documented trust model.
- Direct access to the application port must be blocked.
- Source must eventually use the rightmost proxy-added address, not the untrusted leftmost XFF value.

Current state:

| Item | Status |
|---|---|
| `TRUST_PROXY` documented in `.env.example` | **FAIL** — absent |
| `TRUST_PROXY` read by source | **FAIL** — no source reference |
| Default-deny behavior | **FAIL** — not implemented |
| Rightmost-address parsing | **FAIL** — current code uses leftmost XFF |
| Nginx sanitizes XFF | **NOT VERIFIED** — no app proxy exists |
| App port blocked from direct access | **FAIL for current start path** |
| Nginx-only access | **NOT VERIFIED** |

Deployment prerequisites for a future `TRUST_PROXY=true`:

1. App listens on `127.0.0.1:3000`, not `0.0.0.0`.
2. Nginx has one upstream to that loopback address.
3. Nginx sets a sanitized forwarded header; overwriting with `$remote_addr` is the simplest acceptable policy.
4. The app port is blocked at the host firewall, cloud security group, or both.
5. Source uses the rightmost valid proxy-added address.
6. Direct clients cannot inject a trusted address.
7. `TRUST_PROXY` remains false until all of the above are verified.

This checkpoint does not implement any of these changes.

---

## 9. In-Memory Rate-Limiter Compatibility Assessment

### 9.1 Why one process shares counters

`MemoryRateLimiter` stores buckets in an instance-level `Map`:

- `packages/auth/src/rate-limit.ts:21-27`
- `packages/auth/src/rate-limit.ts:29-53`
- `packages/auth/src/rate-limit.ts:60-68`

The module-level `sharedLimiter` lives once per Node.js process. If exactly one `next start` process serves all route requests, every request handled by that process uses the same limiter instance and therefore the same bucket map.

That is the technical basis for Option C.

### 9.2 Restart behavior

All counters are lost when the process exits. After a restart:

- Login IP and account limits start from zero.
- Any future workspace limits also start from zero.
- An attacker who can force or time restarts gains fresh quota.

Restart resets are accepted for Phase 2 only as an explicit operational limitation.

### 9.3 Process-local scope

If a second process is started:

- On the same port, the second process normally fails to bind and exits with an address-in-use error.
- On a different port, the second process runs independently and has a separate bucket map.
- If Nginx is reconfigured to use both, each process allows its own full quota.
- Direct access to either port bypasses Nginx and can bypass IP-based limits.

A second process therefore invalidates the security assumption even if the first process continues running.

### 9.4 Memory growth and lazy expiry

The limiter has no sweep and no maximum bucket count. Expired buckets remain until the same key is consumed again or the process restarts.

A generic workspace limiter with keys for IP, account, user, tenant, and invitation token will increase key cardinality. Without cleanup or a cap, memory can grow under abusive or high-cardinality traffic. This is an operational monitoring requirement even under Option C.

### 9.5 Fail-closed and HTTP response behavior

`enforceLoginRateLimit()` is fail-closed: a limiter error becomes `503` (`packages/auth/src/rate-limit.ts:94-105`).

However:

- `loginWithPassword()` converts the result to `HttpError` (`packages/auth/src/users.ts:168-178`).
- The login route uses `handleRouteError()` (`apps/web/src/app/api/auth/login/route.ts:25-47`).
- `HttpError` does not carry retry metadata (`packages/auth/src/http.ts:7-19`).
- `errorResponse()` emits only a JSON body (`packages/auth/src/http.ts:21-30`).

The current `429` response therefore does not emit `Retry-After`. A future generic limiter must preserve that header explicitly.

### 9.6 Operational checks required

- Confirm exactly one application PID.
- Confirm one loopback listener.
- Confirm one Nginx upstream.
- Confirm no public app-port exposure.
- Monitor process RSS and bucket cardinality.
- Treat unexpected process count or listener count as a deployment failure.
- Document that restart resets quotas.
- Add `Retry-After` when the generic limiter is implemented.

**Conclusion:** In-memory limiting is technically compatible with Option C only if one process is actually enforced. It is not yet verified in deployment.

---

## 10. Operational Monitoring and Verification Checklist

### Per deployment

- [ ] Correct Git commit and successful build artifact recorded.
- [ ] No pre-existing application process.
- [ ] Exactly one application process after start.
- [ ] Exactly one listener bound to `127.0.0.1:3000`.
- [ ] Nginx has exactly one app upstream.
- [ ] Nginx has no backup or additional app server for this route.
- [ ] A request through Nginx succeeds.
- [ ] A direct request to port 3000 from another host fails.
- [ ] Nginx is the only public HTTP entry point.
- [ ] `TRUST_PROXY` is false until the proxy prerequisites are verified.
- [ ] Restart reset of rate-limit counters is recorded.

### Continuous checks

- [ ] Process count remains exactly one.
- [ ] Listener count remains exactly one.
- [ ] Nginx configuration has not drifted to multiple upstreams.
- [ ] No additional public listener exposes the app.
- [ ] Process memory remains within the accepted envelope.
- [ ] Rate-limit errors fail closed.
- [ ] `429` responses include `Retry-After` after implementation.
- [ ] Audit logs attribute only trusted client addresses.

### External verification

- [ ] Cloud security group or host firewall denies inbound 3000.
- [ ] DNS points only to the approved Nginx entry point.
- [ ] No second VPS or deployment target is active.
- [ ] No platform autoscaling or replica controller is enabled.

---

## 11. Failure Scenarios and Recovery Procedures

### Duplicate application process

**Detection:** more than one `next-server`/`next start` PID, or more than one app listener.

**Response:** identify both PIDs, stop the unintended instance, verify one listener, and investigate how it was started. Restarting the remaining process resets rate-limit counters.

### Nginx upstream drift

**Detection:** two or more `server` entries in the app upstream, backup upstream, or a `proxy_pass` to a second port.

**Response:** restore the reviewed single-upstream configuration and verify through a controlled reload. Do not use rolling reload with two active app instances.

### Direct public app access

**Detection:** external connection to port 3000 succeeds.

**Response:** block the port at the host or cloud firewall, restart the app with loopback binding, and verify from an external host. Treat IP-based limits as compromised until corrected.

### XFF spoofing

**Detection:** client-supplied `X-Forwarded-For` reaches the app unchanged, or direct access is possible.

**Response:** disable trusted-proxy mode, overwrite XFF at Nginx with `$remote_addr`, block direct access, and rely on account/user/tenant buckets until the rightmost-address implementation exists.

### Process restart or crash

**Detection:** process disappears; port closes.

**Response:** start one replacement, verify one listener, and record that quotas reset. If a supervisor exists, ensure it cannot start a second process.

### Memory growth

**Detection:** rising RSS or bucket count.

**Response:** identify high-cardinality keys, reduce retention, restart only as a temporary recovery, and implement bounded expiry before production scale increases.

### Deployment overlap

**Detection:** old and new processes both alive during deployment.

**Response:** stop the old process before starting the new one, or abort the deployment. Do not use blue/green or rolling deployment under this contract.

### Unknown public listener

**Detection:** a non-Nginx public listener such as port 7070 remains accessible.

**Response:** identify its owner and protocol; if it is an HTTP application entry point, disable it or explicitly bring it under the approved ingress policy. Do not probe or modify unrelated services without authorization.

---

## 12. Unverified Items and External Dependencies

The following cannot be verified from this environment:

1. Whether this machine is the intended production VPS.
2. Whether another VPS or deployment target exists.
3. Whether production DNS points to this Nginx instance.
4. Whether a cloud security group or external firewall blocks port 3000.
5. The owner, protocol, and purpose of the public listener on port 7070.
6. Whether a production process supervisor starts the app.
7. Whether the production host uses the repository's `next start` script unchanged.
8. Whether Nginx will overwrite or append XFF after the app proxy is added.
9. Whether TLS/443 will be terminated at Nginx.
10. Whether any platform-level autoscaling or replica controller is active.
11. Whether the production app will bind loopback or all interfaces.
12. Whether the actual runtime uses one Node process for all routes.
13. Whether the production build artifact matches this commit.
14. Whether monitoring covers process count, listener binding, and memory growth.

These items require production host access, DNS/security-group access, or an approved deployment change.

---

## 13. Conditions That Would Invalidate Option C

Option C is invalid if any of the following becomes true:

- More than one Next.js production process serves requests.
- More than one Nginx upstream targets the application.
- PM2 cluster mode, Node cluster mode, or another multi-worker supervisor is used.
- Docker, Kubernetes, or a platform runs more than one application replica.
- Horizontal autoscaling is enabled.
- A second VPS or deployment target serves the same application.
- The application listens on `0.0.0.0` and port 3000 is reachable publicly.
- Nginx is not the only public HTTP entry point.
- A rolling or blue/green deployment runs old and new app processes concurrently.
- `TRUST_PROXY=true` is used without a sanitized proxy header and blocked direct access.
- Source continues to trust the leftmost XFF value after trusted-proxy mode is enabled.
- A second process can be started without an operational failure or detection.
- In-memory bucket growth is not monitored or bounded.

Any one of these conditions requires either restoring the contract or moving to a shared limiter under Option B.

---

## 14. Final Verdict

# **CONTRACT DOCUMENTED — DEPLOYMENT NOT VERIFIED**

The Option C contract is now explicitly documented and can be implemented operationally. The current environment does not demonstrate compliance:

- No Next.js application process is running.
- No Nginx application upstream exists.
- The declared `next start` command defaults to binding `0.0.0.0`.
- No host firewall tools are available to prove port 3000 would be blocked.
- A second public listener exists on port 7070, so Nginx-only HTTP ingress is not established.
- Production host identity, DNS, and external firewall state are unknown.

The contract is not declared unsatisfiable. It is simply not deployed or verified. In-memory rate limiting remains acceptable **only after** the single-process and network-isolation conditions are enforced and verified.

---

## 15. Final Summary

### 1. Does the current environment demonstrably satisfy the contract?

**No.** There is no running app, no app upstream, and the current start path defaults to all-interface binding.

### 2. Which requirements are verified?

- PM2 is not installed and no PM2 configuration was found.
- No Node cluster code or configuration was found.
- No Docker/Podman runtime or app systemd unit was found on this host.
- The approved policy accepts in-memory limiting under Option C.
- The production command is declared as `next start`, but not in a contract-compliant form.

### 3. Which requirements require production VPS or external configuration access?

One-VPS identity, actual process count, Nginx upstream, public ingress, firewall/security-group behavior, autoscaling, DNS, and XFF behavior after proxy configuration.

### 4. Is in-memory rate limiting acceptable for the verified topology?

**Conditionally yes.** It is technically compatible with exactly one process, but the topology is not verified. It must not be treated as a global limiter until the contract is enforced.

### 5. What operational prerequisites remain before implementation?

- Confirm the production host and DNS.
- Bind the app to `127.0.0.1:3000`.
- Add exactly one Nginx upstream.
- Sanitize XFF and block direct app access.
- Enforce one process through a supervisor or pre-start guard.
- Add process, listener, upstream, and memory monitoring.
- Accept and document restart resets.
- Add bounded bucket expiry and `Retry-After` in the future limiter work.
- Implement `TRUST_PROXY` default-deny and rightmost-address parsing in source.

### 6. Recommended next checkpoint

**Checkpoint 2B-0B — Production host provisioning and contract verification**

Provision or verify the actual VPS, Nginx single upstream, loopback binding, firewall, and process supervision. Only after that verification should **Checkpoint 2B-1** begin implementation.

No implementation, migration, configuration change, dependency, or commit is authorized by this report.

**STOP — awaiting explicit product owner approval.**
