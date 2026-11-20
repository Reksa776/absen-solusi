# Phase 2 — Workspace, Member, dan Web Admin Shell

**Tanggal:** 2026-11-19
**Lokasi:** `/home/reksa/absen-solusi/app`
**Status:** **PARSIAL** — B1–B4 dan B6–B9 selesai serta terverifikasi; B5 selesai untuk transport dev (console/memory) dan halaman accept, tetapi transport email production (SMTP/provider) belum diimplementasikan.

## 1. Ringkasan komponen

| Komponen | Status | Bukti utama |
|---|---|---|
| B1 Workspace/member read | Selesai | `workspaces.test.ts` 32/32; read workspace asing/tidak ada sama-sama 403 |
| B2 Accept invitation | Selesai | `invitations.test.ts` 4/4; ACTIVE + role + audit `member.accept_invite` |
| B3 Readiness | Selesai | `health.test.ts` 4/4; HTTP `200` dengan `permissionCount=27` |
| B4 Redis rate limit | Selesai dengan catatan | `redis.test.ts` 3/3; Redis dua instance, mati → 503 |
| B5 Email + halaman accept | **Parsial** | `email.test.ts` 2/2; halaman/form ada; SMTP/provider production belum ada |
| B6 Active workspace switch | Selesai | `workspace-switch.test.ts` 2/2; session berubah + audit; tenant asing 403 |
| B7 Web admin shell | Selesai (UI minimal) | audit viewer 2/2; 7 static UI tests; web build hijau |
| B8 CSP nonce | Selesai | header aktual: `script-src 'self' 'nonce-...' 'strict-dynamic'`; tanpa `unsafe-inline` |
| B9 Audit outbox | Selesai | `outbox.test.ts` 2/2; invite retry; workspace.create rollback |

## 2. Perubahan perilaku

### B1 — Read workspace/member

- `GET /api/workspaces` tetap memakai `loadWorkspacesForUser()` yang menandai
  `SYSTEM:` karena daftar workspace memang lintas tenant dan berasal dari
  membership user yang sudah terautentikasi.
- `GET /api/workspaces/:id/members` memakai `requirePermission("member.read")`
  dan `withTenant`; `:id` hanya klaim. Workspace asing dan tidak ada sama-sama
  **403 `WORKSPACE_NOT_FOUND`** pada read.

### B2 — Accept invitation

Endpoint: `POST /api/invitations/accept`, body `{ token, name?, password? }`.

- Token mentah dicari lewat SHA-256; status PENDING diklaim atomik
  (`updateMany`) agar token tidak dapat dipakai dua kali.
- User existing wajib login dan email sesi harus sama; user baru dibuat hanya
  dengan token valid + `name`/`password`.
- Membership ACTIVE + role invitation + audit `member.accept_invite` dalam satu
  transaksi. Token/hash tidak masuk metadata.
- Error: 404 token salah, 410 expired, 409 reused, 403 email mismatch, 401
  existing user tanpa sesi.

### B3 — Readiness

`GET /api/health/ready` sekarang benar-benar menghitung `permissions` di DB.
Respons `200` hanya bila `SELECT 1` berhasil dan 27 permission lengkap; jika
tidak, `503` dengan `checks.database`, `checks.permissions`,
`checks.permissionCount`, dan `checks.missingPermissions`.

### B4 — Redis

- `REDIS_URL` mengaktifkan `RedisRateLimiter` atomik (EVAL INCR/PEXPIRE/PTTL).
- Production tanpa Redis memakai `UnavailableRateLimiter` → request ditolak 503
  (fail-closed). Dev/test dapat memilih `S1_RATE_LIMITER=memory`.
- Bucket: API umum 300/menit/user; create/invite/role/switch 30/menit/user;
  login tetap 10/15 menit per IP dan akun. 429 membawa `Retry-After`.
- Catatan: host verifikasi tidak memiliki redis-server; test multi-instance
  memakai server RESP in-process. Integrasi Redis nyata belum dieksekusi.

### B5 — Email dan halaman accept

- `packages/auth/src/email.ts` menyediakan interface `EmailTransport`,
  `ConsoleEmailTransport` (dev), `MemoryEmailTransport` (test), dan
  `UnavailableEmailTransport` (production tanpa konfigurasi).
- Route invite mengirim link setelah undangan tersimpan; kegagalan transport
  dicatat tanpa menggagalkan undangan.
- Halaman `/accept-invitation?token=...` memanggil endpoint accept dan
  menampilkan sukses/gagal.
- **Belum ada provider SMTP/email production.** Ini gap B5 dan TD-2-R1.

### B6 — Workspace switch

`POST /api/auth/active-workspace` memvalidasi membership ACTIVE sebelum
memperbarui `active_tenant_id` pada session; audit `workspace.switch_tenant`
ditulis dalam transaksi yang sama. Workspace asing → 403 dan session tidak
berubah. Dropdown switcher ada di `/workspaces`.

### B7 — Shell admin

- `/workspaces`: daftar workspace, switcher, link member/audit.
- `/workspaces/:id/members`: tabel role/status, form invite, form role.
- `/workspaces/:id/audit`: viewer read-only dengan filter action; tenant dari
  `requirePagePermission()` dan `ctx`, bukan URL.
- Semua halaman memakai `requirePagePermission()` dari cookie session.
- UI test saat ini statis (render/build) dan bukan browser E2E.

### B8 — CSP

Middleware membuat nonce per request, meneruskannya lewat `x-nonce` dan
`Content-Security-Policy` request header, serta menghapus
`script-src 'unsafe-inline'`. `style-src` masih memakai `unsafe-inline`
(bukan bagian script-src). Hidrasi browser belum diuji secara visual.

### B9 — Outbox audit

- Aksi non-risiko (`auth.login`, `auth.register_bootstrap`, `member.invite`)
  memakai `enqueueAuditOutbox()` jika INSERT audit gagal.
- `retryAuditOutbox()` memproses `background_jobs` tipe `audit.outbox`;
  kegagalan dicatat pada `background_job_attempts`.
- Aksi berisiko (`workspace.create`, `role.change`, `ownership.transfer`)
  tetap `writeAudit` di transaksi dan rollback total bila audit gagal.

## 3. Verifikasi nyata

```text
npm run test:ci
test_db_ready name=absensi_s1_verify_ci host=127.0.0.1 port=3307
web:         8 pass, 0 fail
auth:       95 pass, 0 fail
database:   28 pass, 0 fail
permissions: 9 pass, 0 fail
TOTAL:     140 pass, 0 fail
```

Clean checkout:

```text
Phase 1: checkpoint-1-closure, 1a-1f, 1i-1n, HEAD = 14 PASS
Phase 2: checkpoint-2a..2i = 9 PASS
```

Catatan riwayat: tag 2b–2h sempat gagal clean-checkout karena test H3 lama
belum memasukkan `/api/invitations/accept`. Tag tersebut diberi commit
test-only yang menyelaraskan ekspektasi H3; source fitur tidak berubah.

Worktree HEAD bersih:

```text
npm ci exit 0
npm run test:ci exit 0
140 pass, 0 fail
worktree_removed=yes
```

Smoke HTTP build production:

```text
GET /api/health/ready -> 200
{"status":"ready","checks":{"database":"up","permissions":"ok",
 "permissionCount":27,"missingPermissions":[]}}
CSP: script-src 'self' 'nonce-<redacted>' 'strict-dynamic'
POST /api/auth/register -> 201
POST /api/auth/login (X-Auth-Mode: bearer) -> 200, token_present=true
POST /api/auth/login tanpa mode/CSRF -> 403 CSRF_INVALID
```

## 4. Tech debt Phase 2

| ID | Item | Alokasi |
|---|---|---|
| TD-2-R1 | Transport email production (SMTP/provider) belum ada; hanya console/memory dan fail-closed | Sebelum onboarding production |
| TD-2-R2 | Hidrasi/CSP nonce belum diuji browser visual; hanya header + build | Sebelum release web |
| TD-2-R3 | Redis nyata tidak tersedia di host verifikasi; multi-instance diuji dengan RESP fake | Infra Phase 3 |
| TD-2-R4 | `GET /api/workspaces` memakai `systemDb` platform-level untuk daftar lintas tenant | Review keamanan Phase 3 |
| TD-2-R5 | Register publik belum memiliki bucket rate limit khusus | Phase 3 |
| TD-2-R6 | UI admin diuji statis/build; belum ada browser E2E | Phase 3 |

## 5. Tech debt Phase 1 yang ditutup

| ID | Status |
|---|---|
| TD-1-R8 | Ditutup: Redis limiter fail-closed, bucket API/workspace, Retry-After |
| TD-1-R9 | Ditutup untuk script-src: nonce, tanpa unsafe-inline |
| TD-1-R11 | Sebagian: accept + halaman + email dev selesai; provider production = TD-2-R1 |
| TD-1-R12/R13 | Ditutup: switcher dan endpoint active workspace |
| TD-1-R14 | Ditutup: outbox + retry untuk aksi non-risiko |

## 6. Batasan yang tidak diklaim

- B5 email production belum ada; hanya console/memory dan fail-closed
  (TD-2-R1).
- CSP nonce belum diuji dengan browser visual/hidrasi; verifikasi baru pada
  header dan build (TD-2-R2).
- Redis nyata belum diuji di host ini; multi-instance diuji dengan server RESP
  in-process dan produksi fail-closed tanpa `REDIS_URL` (TD-2-R3).
- Tidak ada browser E2E untuk halaman web.
- Tidak ada pengiriman email nyata ke provider/SMTP.
- Tidak ada push, remote baru, force push, atau rebase.
- `/home/reksa/affiliateos` tidak dibuka, dibaca, di-`ls`, di-`grep`, di-copy,
  di-commit, di-push, diubah, atau dihapus.
- `/home/reksa/absen-solusi/install.sh` tidak diubah; hash tetap
  `c73dad4dcf7c9ecadb98578e28cc763d23d7be3fa1b513545319038795493214`.
