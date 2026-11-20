# Phase 1 — Laporan Perbaikan Audit

**Tanggal:** 2026-11-19
**Lokasi:** `/home/reksa/absen-solusi/app`
**Sumber temuan:** [`AUDIT-PHASE-1-2026-11-19.md`](./AUDIT-PHASE-1-2026-11-19.md)
**Status:** seluruh temuan audit Phase 1 ditutup atau didokumentasikan sebagai
Phase 2; tidak ada temuan yang disembunyikan.

Dokumen ini merangkum perubahan, test regresi, dan output nyata. Angka test
berasal dari MariaDB test terisolasi, bukan mock.

---

## 1. Ringkasan per kelompok

| Kelompok | Temuan | Commit | Tag | Status |
|---|---|---|---|---|
| 1 — CRITICAL | C-01 tenant mutation | `153084b` | `checkpoint-1i` | Selesai |
| 2 — HIGH | H-01 build/CI clean checkout | `f32a511` | `checkpoint-1j` | Selesai |
| 3 — HIGH | H-02/H-03/M-02 bearer, proxy, session | `bd56fb0` | `checkpoint-1k` | Selesai |
| 4 — HIGH | H-04 reproducible test suite | `7ad64e9` | `checkpoint-1l` | Selesai |
| 5 — MEDIUM | M-01..M-07 | `5dfc44c` | `checkpoint-1m` | Selesai |
| 6 — LOW | L-01..L-03 | `df91153` | `checkpoint-1n` | Selesai |

Tidak ada `checkpoint-1g`/`1h`: memang tidak ada commit terpisah untuk G/H.
Riwayat tidak ditulis ulang; klaim di [`PHASE-1.md`](./PHASE-1.md) dikoreksi.

---

## 2. Kelompok 1 — C-01 (tenant mutation)

**Perubahan:** `packages/database/src/tenant-db.ts`

- `update`, `updateMany`, `upsert.update` menolak `tenantId` di `data`
  (`TenantWriteScopeError`); `Workspace` juga menolak perubahan `id`.
- `upsert.create` dipaksa memakai tenant context; `tenantId` pemanggil tidak
  dipercaya.
- Nested write ditolak (`TenantNestedWriteError`).
- `$queryRaw`, `$queryRawUnsafe`, `$executeRaw`, `$executeRawUnsafe` pada client
  tenant ditolak (`TenantRawQueryError`).
- `BackgroundJobAttempt` dikeluarkan dari allowlist karena tidak punya
  `tenant_id`.

**Test:** T10–T14 di `packages/database/src/tenant-db.test.ts`; suite database
**26/26 pass**.

**Probe manual nyata:**

```
C01_PROBE=REJECTED name=TenantWriteScopeError message=withTenant: operasi WorkspaceMember.update ditolak; field tenantId tidak boleh ditulis dari data
C01_ROW_TENANT_UNCHANGED=true tenant=74aa3d2f-01d5-477d-8cbc-5597bc9e49ed
```

Probe mengembalikan error, bukan `SUCCESS`; baris tenant A tetap di tenant A.

---

## 3. Kelompok 2 — H-01 (build/CI)

- Urutan build workspace: `permissions → database → auth → worker → web`.
- `package.json` root memiliki `build:packages`, `test:run`, `test:ci`.
- `apps/web` build memakai `NODE_ENV=production next build`; ini menghindari
  crash prerender `/_global-error` saat mewarisi `NODE_ENV=development`.
- `scripts/ci-clean-checkout.sh` membuat worktree baru untuk setiap tag,
  menjalankan `npm ci`, build, typecheck, dan test; gagal bila satu tag gagal.

**Bukti:** seluruh tag lulus clean checkout (lihat §8).

---

## 4. Kelompok 3 — H-02/H-03/M-02

- **H-02:** `assertPublicCsrf(request, { allowBearerMode: true })` pada login;
  `X-Auth-Mode: bearer` tanpa `Authorization` dummy diterima. Kontrak mobile
  dan `PHASE-1.md` diselaraskan.
- **H-03:** `TRUST_PROXY` default-deny. Tanpa `TRUST_PROXY=true`, XFF/X-Real-IP
  tidak dipercaya. Dengan `true`, rightmost XFF yang dipakai.
- **M-02:** role change dan ownership transfer memanggil
  `revokeAllSessionsForUser` untuk sesi target (dan aktor pada transfer).

**Test:** auth 80/80 (termasuk F7, F8, B7); HTTP nyata di §7.

---

## 5. Kelompok 4 — H-04 (test reproducible)

- `scripts/test-db-setup.mjs`: membuat database `absensi_s1_verify_*`, user
  `s1_admin_ci`/`s1_app_ci`, migration, dan grant; kredensial hanya di
  `.env.test` sementara.
- Cleanup test aman saat `before()` gagal; tidak ada `TypeError` cleanup.
- Satu perintah: `npm run test:ci`.
- `scripts/ci-clean-checkout.sh` dapat dijalankan tanpa setup manual.

**Bukti:** `npm run test:ci` exit 0; **117 pass, 0 fail**.

---

## 6. Kelompok 5 — MEDIUM

### M-01 — klaim checkpoint

Tidak dibuat tag palsu `1g`/`1h`. `PHASE-1.md` §10 sekarang menyatakan tag yang
benar-benar ada dan alasan tidak adanya 1g/1h.

### M-03 — CSP

`script-src 'unsafe-inline'` **tetap dipertahankan**, bukan dihapus. Next 16 App
Router menyisipkan bootstrap inline; nonce memerlukan rendering dinamis per
request dan berisiko memecah shell statis. Alasan dan risiko XSS yang lebih
lemah dicatat di D-1-10 dan TD-1-R9. Ini adalah keputusan terdokumentasi, bukan
klaim CSP ketat.

### M-04 — audit fail-closed

`writeAudit(input, client)` menerima transaction client. `workspace.create`,
`role.change`, dan `ownership.transfer` menulis audit di dalam transaksi yang
sama; kegagalan audit membatalkan operasi. Test trigger DB:
`M4: kegagalan audit menggagalkan workspace.create/role change/ownership
transfer dan rollback` — ketiganya lulus.

### M-05 — Retry-After

`HttpError` membawa `retryAfterSeconds`; `errorResponse` menulis header
`Retry-After`. Login 429 nyata:

```
rate_limit_429_at_attempt=9
retry-after: 883
{"error":{"code":"RATE_LIMITED",...}}
```

Limiter tetap in-memory; multi-instance Redis adalah TD-1-R8 Phase 2.

### M-06 — B7 dan route nyata

B7 sekarang mengirim cookie `aos_csrf=cookie-token` dan header
`x-csrf-token: header-token` yang benar-benar berbeda; mismatch menghasilkan
403. Route login/register diuji lewat HTTP nyata (§7), bukan hanya unit test.

### M-07 — invitation token

Respons produksi hanya memuat `invitationId,email,roleKey,expiresAt`; tidak ada
properti `token`. Echo dev hanya jika `S1_INVITATION_TOKEN_ECHO=true` dan
`NODE_ENV` bukan production.

**Bukti HTTP:**

```
invite_status=201
invite_keys=invitationId,email,roleKey,expiresAt
invite_has_token_property=false
invite_contains_token_literal=false
```

---

## 7. Kelompok 6 — LOW

- **L-01:** `poweredByHeader: false` di `apps/web/next.config.ts`. Header
  `x-powered-by` tidak muncul pada respons yang diperiksa.
- **L-02:** workspace switcher dan endpoint pindah `active_tenant_id` belum ada;
  didokumentasikan sebagai **Phase 2** (TD-1-R12/R13), bukan diklaim selesai.
- **L-03:** `/home/reksa/absen-solusi/install.sh` **bukan milik proyek ini**.
  Header menunjukkan Hermes Agent bootstrap (`NousResearch/hermes-agent`).
  Hash acuan penuh disimpan di [`INSTALL-SHA256.txt`](./INSTALL-SHA256.txt):
  `c73dad4dcf7c9ecadb98578e28cc763d23d7be3fa1b513545319038795493214`.
  File tidak diubah/dihapus/dipindahkan.

---

## 8. Verifikasi akhir (output nyata)

### Build, typecheck, test

Dari worktree saat ini:

```
build=0
typecheck=0
test_ci_exit=0
web:        tests 2  pass 2  fail 0
auth:       tests 80 pass 80 fail 0
database:   tests 26 pass 26 fail 0
permissions:tests 9  pass 9  fail 0
```

### CI clean checkout semua tag

`scripts/ci-clean-checkout.sh` (13 checkout: 1a–1f, 1i–1n, HEAD):

```
RESULT checkpoint-1a PASS
RESULT checkpoint-1b PASS
RESULT checkpoint-1c PASS
RESULT checkpoint-1d PASS
RESULT checkpoint-1e PASS
RESULT checkpoint-1f PASS
RESULT checkpoint-1i PASS
RESULT checkpoint-1j PASS
RESULT checkpoint-1k PASS
RESULT checkpoint-1l PASS
RESULT checkpoint-1m PASS
RESULT checkpoint-1n PASS
RESULT HEAD PASS
CI_CLEAN_CHECKOUT=pass tags=13
```

Catatan: percobaan pertama gagal karena `/tmp` (tmpfs 3.6 GB) penuh saat
`npm ci`; worktree sementara dibersihkan dan percobaan kedua exit 0. Kegagalan
pertama adalah lingkungan, bukan kode.

### HTTP nyata (production build, test DB)

```
register_status=201
register_without_csrf_status=403 CSRF_INVALID
register_with_csrf_status=403 REGISTRATION_CLOSED
login_status=HTTP/1.1 200 OK (X-Auth-Mode: bearer, tanpa Authorization)
login_token_present=true
cookie_login_status=200
set-cookie: __Host-aos_session=...; HttpOnly; Secure; SameSite=lax
content-security-policy: ... script-src 'self' 'unsafe-inline' ...
429: Retry-After: 883
invite: 201, tanpa token
```

`TRUST_PROXY=false`: XFF palsu tidak lolos dari bucket IP langsung → 429.
`TRUST_PROXY=true`: bucket IP langsung 429; XFF `203.0.113.9` yang sudah
dihabiskan + rightmost `198.51.100.7` baru → 401, membuktikan rightmost dipakai.

### C-01

Lihat §2: `TenantWriteScopeError`, baris tidak berpindah.

---

## 9. Tech debt (ID TD-1-Rn)

| ID | Item | Alokasi |
|---|---|---|
| TD-1-R8 | Rate limiter in-memory; butuh Redis/DB untuk multi-instance. `Retry-After` sudah ada. | Phase 2 |
| TD-1-R9 | CSP `script-src 'unsafe-inline'` dipertahankan karena bootstrap Next 16; nonce/hash belum. Risiko XSS mitigation lebih lemah. | Phase 2 |
| TD-1-R11 | Email + halaman accept undangan belum ada; token produksi tidak lagi dikembalikan. | Phase 2 |
| TD-1-R12 | Workspace switcher belum ada. | Phase 2 |
| TD-1-R13 | Endpoint pindah `active_tenant_id` belum ada. | Phase 2 |
| TD-1-R14 | Outbox/retry audit untuk aksi non-risiko (login/register/invite) belum ada. | Phase 2 |
| TD-1-R16 | Raw query di dalam `$transaction` belum dijaga proxy otomatis; hanya lock workspace tervalidasi yang memakainya. | Phase 2 |

---

## 10. Pernyataan penutup

- Temuan yang **tertutup**: C-01, H-01, H-02, H-03, H-04, M-01, M-02, M-04,
  M-05, M-06, M-07, L-01, L-03.
- Temuan yang **didokumentasikan, belum diimplementasikan**: M-03 (CSP
  `unsafe-inline` dipertahankan dengan alasan/risiko), L-02 (workspace switcher
  Phase 2), TD-1-R8/R9/R11/R12/R13/R14/R16.
- `/home/reksa/affiliateos` **tidak dibuka, dibaca, diubah, atau disentuh**.
- `/home/reksa/absen-solusi/install.sh` **utuh**; hash penuh di
  `docs/INSTALL-SHA256.txt`.
- Tidak ada `git push`, remote baru, force push, atau rebase.
