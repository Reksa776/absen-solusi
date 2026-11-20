# Audit Phase 1 — Verifikasi Ulang Independen

**Tanggal:** 2026-11-19
**Lokasi:** `/home/reksa/absen-solusi/app`
**Ruang lingkup:** hanya lima bukti kritis; bukan audit penuh ulang.
**Dokumen yang diverifikasi:** [`PHASE-1-FIXES.md`](./PHASE-1-FIXES.md)

Tidak ada source proyek yang diubah. Satu-satunya tulisan di proyek adalah
dokumen ini. Token, cookie, password, dan kredensial tidak dicetak.

---

## 1. Hasil ringkas

| Verifikasi | Hasil nyata | Status |
|---|---|---|
| V1 — C-01 tenant mutation | T10–T14 5/5 pass; probe manual `TenantWriteScopeError`; baris tetap di tenant A; cleanup 0 sisa | **PASS** |
| V2 — CI clean checkout per tag | 13 checkout (1a–1f, 1i–1n, HEAD): 13 PASS; `ci_exit=0` | **PASS** |
| V3 — Login mobile Bearer | `X-Auth-Mode: bearer` tanpa Authorization: 200, `token_present=true`; kontrol negatif: 403 `CSRF_INVALID` | **PASS** |
| V4 — TRUST_PROXY rightmost XFF | `false`: XFF palsu tetap 429; `true`: IP langsung 429, XFF kiri dihabiskan, header dua-IP → 401 dari kanan yang baru | **PASS** |
| V5 — Test suite reproducible | `npm ci=0`; `test:ci=0`; 117 pass, 0 fail (web 2, auth 80, database 26, permissions 9) | **PASS dengan prasyarat env** |

---

## 2. V1 — C-01 tenant mutation

Test yang dijalankan dari `packages/database/src/tenant-db.test.ts` (setelah
build paket database):

```text
✔ T10: update data tenantId ditolak dan baris A tetap di A
✔ T11: updateMany data tenantId ditolak
✔ T12: upsert memaksa create ke tenant A dan menolak update tenantId
✔ T13: nested write ditolak sebelum menyentuh database
✔ T14: raw query pada client tenant ditolak
ℹ tests 5
ℹ pass 5
ℹ fail 0
```

Probe manual memakai database test terisolasi: dua tenant A/B, satu membership
di A, lalu `withTenant(ctxA).workspaceMember.update({ where: { id: memberA },
data: { tenantId: tenantB, status: "INACTIVE" } })`.

```text
C01_PROBE=REJECTED name=TenantWriteScopeError
C01_MESSAGE=withTenant: operasi WorkspaceMember.update ditolak; field tenantId tidak boleh ditulis dari data
C01_ROW_TENANT_UNCHANGED=true
C01_ROW_STATUS_UNCHANGED=true
C01_CLEANUP_REMAINING members=0 workspaces=0 users=0
```

Probe tidak meninggalkan baris. Database test yang dipakai adalah
`absensi_s1_verify_ci` dengan guard test; bukan database development.

---

## 3. V2 — CI clean checkout

Perintah:

```bash
scripts/ci-clean-checkout.sh
```

Output per tag:

```text
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
ci_exit=0
```

Tidak ada kegagalan ruang disk pada percobaan ini; `/tmp` memiliki sekitar
3,5 GB bebas sebelum eksekusi.

---

## 4. V3 — Login mobile Bearer

Server production build berjalan di `127.0.0.1:3111` dengan database test.
Registrasi bootstrap HTTP berhasil (`register_status=201`), lalu login:

```text
bearer_login_status=200 authorization_header_sent=no
token_present=true token_length_positive=true
```

Kontrol negatif tanpa `X-Auth-Mode` dan tanpa `Authorization`:

```text
negative_no_mode_no_auth_status=403
negative_error_code=CSRF_INVALID
```

Token tidak dicetak. Cookie dan kredensial tidak dicetak.

---

## 5. V4 — TRUST_PROXY rightmost XFF

`TRUST_PROXY=false`:

```text
direct_ip_429_at=10
direct_ip_last_status=429
trust_proxy_false_fake_xff_status=429
trust_proxy_false_error_code=RATE_LIMITED
```

XFF palsu `203.0.113.9` tidak membuka bucket baru; bucket IP langsung tetap
menentukan dan menghasilkan 429.

`TRUST_PROXY=true`:

```text
true_direct_429_at=11
true_direct_last_status=429
left_bucket_429_count=0
left_exhausted_right_fresh_status=401
rightmost_probe_error_code=INVALID_CREDENTIALS
```

Bucket `203.0.113.9` (kiri) dihabiskan dengan 10 request tanpa 429. Request
berikut memakai `X-Forwarded-For: 203.0.113.9, 198.51.100.7`; hasil 401 dari
bucket `198.51.100.7` (kanan) yang baru. Jika implementasi memakai leftmost,
request tersebut akan 429. Jadi rightmost terbukti dipakai.

---

## 6. V5 — Test suite reproducible

Worktree baru: `/tmp/reverify-wt` pada HEAD, kemudian dihapus.

**Percobaan pertama, persis tanpa environment DB tambahan:**

```text
worktree_add_exit=0
npm_ci_exit=0
test_ci_exit=1
Error: S1_TEST_ADMIN_URL atau DATABASE_URL wajib untuk setup test DB
```

Penyebab: worktree bersih tidak membawa `.env` (gitignored) yang berisi
kredensial admin database. Ini kegagalan konfigurasi environment, bukan
kegagalan test; `npm ci` sendiri exit 0.

**Percobaan kedua, dengan environment admin DB yang sama seperti
`ci-clean-checkout.sh`, tanpa menulis kredensial ke worktree:**

```text
worktree_add_exit=0
npm_ci_exit=0
test_ci_exit=0
test_db_ready name=absensi_s1_verify_ci host=127.0.0.1 port=3307
web:         tests 2  pass 2  fail 0
auth:        tests 80 pass 80 fail 0
database:    tests 26 pass 26 fail 0
permissions: tests 9  pass 9  fail 0
worktree_removed=yes
```

Prasyarat yang harus didokumentasikan: `npm run test:ci` memerlukan
`DATABASE_URL`/`S1_TEST_ADMIN_URL` yang dapat membuat database test. Worktree
bersih tidak memiliki file `.env` karena file itu gitignored.

---

## 7. Pemeriksaan tambahan

```text
HEAD 2849444
Tags: checkpoint-1a..1f, checkpoint-1i..1n (12 tag; tidak ada 1g/1h)
```

`git status --porcelain` masih memuat file pra-ada yang bukan hasil verifikasi
ini:

```text
 M docs/PROJECT-CURRENT-STATE-AUDIT.md
?? docs/AUDIT-PHASE-1-2026-11-19.md
?? docs/PHASE-2-*.md
?? docs/PHASE-3-READINESS-REPORT.md
```

`install.sh`:

```text
sha256sum: c73dad4dcf7c9ecadb98578e28cc763d23d7be3fa1b513545319038795493214
docs/INSTALL-SHA256.txt: SHA-256: c73dad4dcf7c9ecadb98578e28cc763d23d7be3fa1b513545319038795493214
```

Hash cocok penuh. File bukan milik aplikasi absensi; header menunjukkan Hermes
Agent bootstrap. File tidak diubah/dihapus/dipindahkan.

---

## 8. Verdict

**Phase 1 SELESAI** untuk lima bukti kritis: C-01 tertutup dan teruji, seluruh
tag buildable dari checkout bersih, kontrak mobile Bearer bekerja, `TRUST_PROXY`
memakai rightmost XFF, dan suite reproducible pada worktree baru dengan
environment DB yang diperlukan.

Catatan sebelum Phase 2:

1. Putuskan/commit dokumen pra-ada agar `git status` bersih.
2. Dokumentasikan atau otomatiskan penyediaan `DATABASE_URL`/`S1_TEST_ADMIN_URL`
   untuk worktree bersih agar `npm run test:ci` tidak bergantung pada `.env`
   lokal.
3. Siapkan Redis untuk rate limiter multi-instance dan kanal email/halaman
   accept undangan (TD-1-R8/R11).

Pernyataan eksplisit:

- `/home/reksa/affiliateos` tidak dibuka, dibaca, di-`ls`, di-`grep`, di-copy,
  di-commit, di-push, diubah, atau dihapus selama verifikasi ini.
- `install.sh` utuh; hash cocok dengan dokumen acuan.
- Tidak ada perubahan source proyek; tidak ada commit, stash, push, force push,
  atau rebase.
- Dokumen verifikasi ini: `docs/AUDIT-PHASE-1-REVERIFY-2026-11-19.md`.
