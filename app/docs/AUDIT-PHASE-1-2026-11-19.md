# Audit Independen Phase 1 — Aplikasi Absensi

**Tanggal audit:** 2026-11-19  
**Lokasi proyek:** `/home/reksa/absen-solusi/app`  
**Commit yang diaudit:** `ab9bc0cd7e0edfa93448b3cb297d472bc488c9ef` (`main`)  
**Lingkup:** fondasi Phase 1 (komponen A–H) dan kesiapan menuju Phase 2–4. Phase 5+ tidak dinilai.  
**Sifat audit:** independen; klaim `docs/PHASE-1.md` dan laporan checkpoint tidak dipercaya tanpa bukti.

> **Aturan yang dipatuhi:** `/home/reksa/affiliateos` tidak dibuka, dibaca, dicari, diubah, atau dijadikan referensi. Tidak ada commit, push, stash, revert, rebase, atau perubahan source. Satu-satunya file yang ditulis adalah dokumen audit ini. `/home/reksa/absen-solusi/install.sh` tidak diubah.

---

## 0. Ringkasan eksekutif

**Verdict: PARTIAL (78%).** Fondasi utama ada dan sebagian besar test service-level lulus terhadap MariaDB nyata: 105 test lulus dengan DB test terisolasi, 27 permission/6 role/162 matrix lulus, header keamanan nyata terkirim, cookie sesi produksi benar, grant append-only `audit_logs` benar, dan probe DML ditolak `1142`.

Namun Phase 1 **belum dapat disebut SELESAI** karena ada empat hal yang membedakan “ada implementasi” dari “fondasi aman dan reproducible”:

1. **Celah tenant kritis:** `withTenant(ctxA)` dapat memindahkan baris milik A ke tenant B melalui `data: { tenantId: B }`. Probe nyata berhasil; ini melanggar inti tenant isolation.
2. **Build dari checkout bersih gagal:** seluruh tag `checkpoint-1a`–`1f` dan HEAD gagal `npm run build`; build working tree saat ini hanya lulus karena artefak `dist` lama sudah ada.
3. **Login mobile sesuai kontrak `X-Auth-Mode: bearer` gagal 403 CSRF**, sehingga backend belum siap melayani flow mobile yang didokumentasikan.
4. **`TRUST_PROXY` tidak dibaca source** dan `getClientIp()` memakai alamat paling kiri `X-Forwarded-For`; rate limit per-IP dan `ip_hash` audit dapat dipalsukan.

### Lima temuan teratas

| Peringkat | ID | Severity | Temuan singkat |
|---|---|---|---|
| 1 | C-01 | **CRITICAL** | `withTenant` mengizinkan perpindahan baris antar-tenant lewat `data.tenantId`; probe nyata berhasil. |
| 2 | H-01 | **HIGH** | Build checkout bersih gagal pada semua tag Phase 1 dan HEAD; klaim “setiap checkpoint buildable” tidak terbukti. |
| 3 | H-02 | **HIGH** | Login mobile `X-Auth-Mode: bearer` tanpa `Authorization` ditolak `CSRF_INVALID` 403; flow mobile resmi tidak berjalan. |
| 4 | H-03 | **HIGH** | Tidak ada trusted-proxy handling; XFF paling kiri dipercaya, sehingga rate limit IP dan audit IP dapat di-spoof. |
| 5 | H-04 | **HIGH** | `npm test` tanpa setup DB guard gagal 53 test auth + cleanup DB; test suite tidak reproducible dengan perintah yang didokumentasikan. |

### Tiga hal yang harus dibereskan sebelum Phase 2

1. **Tutup celah tenant pada `update`/`updateMany`/`upsert`**: larang `tenantId` di `data`, paksa `create` pada `upsert`, tangani nested write/raw query, lalu tambah test DB yang membuktikan baris tidak dapat berpindah tenant.
2. **Perbaiki build graph dan CI dari checkout bersih**: urutan build `permissions` sebelum `database`, perbaiki error TypeScript test, dan jalankan `npm ci && npm run build && npm test` di worktree baru untuk setiap tag/HEAD.
3. **Perbaiki batas identitas perimeter**: implementasikan `TRUST_PROXY` default-deny dengan rightmost XFF, perbaiki kontrak CSRF login mobile, dan pertimbangkan rotasi sesi saat privilege berubah.

### Tiga hal yang TIDAK boleh diklaim selesai sampai ada bukti baru

1. **“Semua checkpoint Phase 1 buildable.”** Semua tag yang ada gagal build dari checkout bersih; tidak ada tag `1g`/`1h`.
2. **“Isolasi tenant sudah tertutup.”** Service-level test lulus untuk operasi normal, tetapi probe `data.tenantId` membuktikan isolasi belum tertutup.
3. **“Mobile Bearer dan perimeter produksi sudah siap.”** Login mobile resmi gagal CSRF, dan trusted-proxy/TLS/proxy deployment belum diterapkan atau diuji.

---

## 1. Batas dan metode audit

- Audit dilakukan dengan membaca kode aktual, menjalankan test pada MariaDB, memeriksa `information_schema`/grant, dan mengambil respons HTTP nyata dari server produksi lokal.
- DB development `.devdb` dinyalakan pada port `3307` karena `.env` menunjuk ke sana. Test destruktif dijalankan pada database terisolasi `absensi_s1_verify_audit`, bukan `absensi_dev`.
- Semua baris/user/workspace/probe yang dibuat untuk audit sudah dibersihkan. DB `.devdb` dihentikan setelah audit; port `3100`, `3101`, dan `3307` tidak lagi listening.
- Tidak ada akses root host, VPS, DNS, TLS terminator, atau remote Git. Karena itu hal-hal yang memerlukan deployment nyata ditandai **TIDAK TERVERIFIKASI**, bukan dianggap lulus.
- `SHOW GRANTS` pernah mengeluarkan password verifier MySQL. Nilainya **tidak dimasukkan** ke laporan ini; hanya ringkasan grant yang dilaporkan.
- Nilai token, cookie, password, hash password, dan kredensial tidak dicetak dalam dokumen ini.

---

## 2. Langkah 1 — Integritas repo dan lokasi

### 2.1 Lokasi dan status

```text
pwd                          = /home/reksa/absen-solusi/app
branch                       = main
HEAD                         = ab9bc0cd7e0edfa93448b3cb297d472bc488c9ef
git remote -v                = (kosong; tidak ada remote terkonfigurasi)
```

`git status --porcelain` pada awal dan akhir audit menunjukkan:

```text
 M docs/PROJECT-CURRENT-STATE-AUDIT.md
?? docs/PHASE-2-... (9 dokumen Phase 2/3 yang sudah ada sebelum audit)
```

Tidak ada file source yang berubah. Satu-satunya tambahan dari audit adalah dokumen ini (`docs/AUDIT-PHASE-1-2026-11-19.md`). Perubahan `docs/PROJECT-CURRENT-STATE-AUDIT.md` sudah ada sebelum audit dan bukan hasil audit.

### 2.2 Riwayat dan tag

Tag yang tersedia hanya:

```text
checkpoint-1a
checkpoint-1b
checkpoint-1c
checkpoint-1d
checkpoint-1e
checkpoint-1f
```

**Tidak ada `checkpoint-1g` atau `checkpoint-1h`.** Riwayat `--all` yang terlihat berakhir pada:

```text
ab9bc0c feat(workspace): add Phase 2 read APIs and harden workspace security
61e1398 feat(web): add Phase 1 sign-in, session landing, and sign-out shell
47e77c0 feat(security): headers middleware, redacting logger, bundler-safe env load (P1 F)
```

Dengan demikian klaim “setiap checkpoint Phase 1” tidak dapat diverifikasi untuk G/H sebagai tag; G hanya ada sebagai commit, H tidak memiliki tag checkpoint.

### 2.3 `.devdb`, `.env`, dan secret di history

Perintah yang dijalankan:

```bash
git ls-files | grep -i devdb
git log --all --oneline -- .devdb
git rev-list --objects --all | grep -i devdb
git log --all --full-history -- .env
git grep -nE 'sk-|ghp_|AKIA|password\s*=\s*["'"'"'][^"'"'"']+' \
  $(git rev-list --all) -- . ':!.lock' ':!.md'
```

Hasil:

- Tidak ada `.devdb/` di index atau history.
- Tidak ada `.env` di history.
- Pola secret hanya ditemukan pada file test/dokumen contoh, bukan file environment tracked. Tidak ditemukan nilai secret nyata yang perlu dilaporkan.
- `.env` aktual ada di working tree dan gitignored; nilainya tidak dibaca ke laporan.

### 2.4 `install.sh`

```text
path    = /home/reksa/absen-solusi/install.sh
size    = 68015 byte
mode    = 664
mtime   = 2026-11-17 15:35:39 +0700
sha256  = c73dad4dcf7c9ecadb98578e28cc763d23d7be3fa1b513545319038795493214
```

File **tidak diubah** oleh audit. Hash aktual berakhiran `493214`, cocok dengan suffix yang dilaporkan, tetapi **prefix aktual adalah `c73dad`, bukan `c9...`**. Karena itu klaim pembanding `c9...493214` tidak dapat dikonfirmasi sebagai hash file ini. Isi file terlihat sebagai bootstrap Hermes, bukan installer proyek absensi; ini catatan integritas, bukan bukti bahwa file tersebut memang installer yang dimaksud.

---

## 3. Langkah 2 — Buildability dari checkout bersih

### 3.1 Hasil per tag

Untuk setiap tag, dibuat worktree terpisah di `/tmp/audit-wt`, lalu dijalankan `npm ci`, `npm run build`, `npm run typecheck`, dan `npm test`. Worktree dihapus setelah selesai.

| Tag | `npm ci` | `npm run build` | `npm run typecheck` | `npm test` |
|---|---:|---:|---:|---:|
| `checkpoint-1a` | 0 | **2** | 0 | 1 |
| `checkpoint-1b` | 0 | **2** | 0 | 1 |
| `checkpoint-1c` | 0 | **2** | 0 | 1 |
| `checkpoint-1d` | 0 | **2** | 0 | 1 |
| `checkpoint-1e` | 0 | **2** | 0 | 1 |
| `checkpoint-1f` | 0 | **2** | 0 | 1 |

Error build yang muncul pada tag antara lain:

```text
packages/database/src/rbac.ts(10,8): error TS2307:
Cannot find module '@absensi/permissions' or its corresponding type declarations.
```

Penyebab yang terlihat: workspace `@absensi/database` dibangun sebelum `@absensi/permissions`, sementara `database` mengimpor tipe dari `permissions`. Ada juga error `TS2375` pada test database terkait `exactOptionalPropertyTypes`.

`npm test` pada tag juga tidak menghasilkan suite yang valid karena build/DB guard gagal lebih dulu. Ini bukan bukti test bisnis gagal; ini bukti bahwa perintah build/test dari checkout bersih tidak reproducible.

### 3.2 HEAD bersih juga gagal

Worktree bersih pada HEAD `ab9bc0c`:

```text
npm ci            = 0
npm run build     = 2
npm run typecheck = 0
```

Error utama:

```text
packages/database/src/tenant-db.test.ts(74,7): error TS2375 ...
Type 'string | undefined' is not assignable to type 'string'
```

### 3.3 Mengapa working tree tampak lulus

Pada working tree utama, `npm run build` dan `npm run typecheck` mengembalikan `0`. Itu **bukan** bukti checkout bersih buildable: artefak `dist`/`.next` dari eksekusi sebelumnya sudah ada. Worktree bersih HEAD dan semua tag membuktikan sebaliknya.

**Temuan H-01 (HIGH):** klaim “setiap checkpoint buildable” salah untuk semua tag yang tersedia dan untuk HEAD bersih.

---

## 4. Langkah 3 — Verifikasi komponen A–H

`docs/PHASE-1.md` mengklaim A–H “Selesai”. Berikut hasil pemeriksaan aktual.

| Komponen | Artefak yang diperiksa | Test/bukti nyata | Status audit |
|---|---|---|---|
| **A. Database & tenant foundation** | `schema.prisma`, migration M1, `grants.sql`, `client.ts`, `tenant-db.ts`, `audit.ts` | 21 test database lulus pada DB terisolasi; schema 13 tabel termasuk `_prisma_migrations`; grant dan probe DML diperiksa | **PASS dengan catatan CRITICAL C-01** |
| **B. Auth & session** | `password.ts`, `session.ts`, `csrf.ts`, `rate-limit.ts`, `http.ts`, `users.ts`, route `/api/auth/*` | 73 test auth lulus; login web nyata 200; cookie `__Host-aos_session` benar; login mobile kontrak resmi gagal 403 | **PARTIAL** |
| **C. RBAC** | `permissions` catalog, `requirePermission`, route policy | 27 permission, 6 role, matrix 162; 9 test permission lulus; 73 test auth termasuk RBAC lulus | **PASS** |
| **D. Workspace/member/invitation** | `workspaces.ts`, route workspace/member/role | Test workspace/role/cross-tenant lulus; route policy 11 route; HTTP workspace belum diuji dua sesi | **PASS service-level; HTTP dua-sesi TIDAK TERVERIFIKASI** |
| **E. Audit** | `audit.ts`, grant `audit_logs`, test audit | Test append-only dan redaksi lulus; grant DB `SELECT, INSERT`; writeAudit best-effort | **PASS dengan catatan M-04** |
| **F. Security headers & logger** | `security-headers.ts`, `middleware.ts`, `logger.ts` | Header nyata diperiksa via curl; test redaksi lulus; CSP masih `unsafe-inline` | **PASS dengan catatan M-03** |
| **G. Web shell + mobile placeholder** | `/sign-in`, landing, sign-out, `apps/mobile/README.md` | `/sign-in` 200; `/` 307 ke sign-in; test route policy 2 lulus; shell minimal, bukan admin lengkap | **PASS untuk shell Phase 1** |
| **H. Test suite** | test auth/database/web/permissions, route policy | 105 test lulus **hanya** dengan DB test + grant; `npm test` tanpa guard exit 1 (53 auth gagal) | **PARTIAL / tidak CI-ready** |

### Catatan penting per komponen

- **A:** 12 model DML sesuai dokumen, tetapi schema nyata berisi 13 tabel karena `_prisma_migrations`. Tenant isolation normal lulus, tetapi ada celah `data.tenantId` yang dibuktikan di §6.
- **B:** Argon2id, session store tunggal, cookie/Bearer, TTL, idle timeout, rate limit, dan CSRF cookie-mode ada dan diuji. Mobile login resmi tidak lolos CSRF; lihat §8.
- **C:** `requirePermission()` mengambil role/permission dari DB setiap request. Matrix 162 dan katalog 27 konsisten.
- **D:** `assertWorkspaceClaim` memberi 404 identik untuk workspace asing/tidak ada. Ini diuji pada service; dua sesi HTTP nyata tidak diulang.
- **E:** `writeAudit` best-effort. Grant DB append-only kuat, tetapi kegagalan audit tidak menggagalkan operasi bisnis.
- **F:** Header aktual lengkap; HSTS hanya production. `Cache-Control` API `no-store`; halaman dinamis juga mendapat `no-store` dari Next.
- **G:** Shell web ada dan berfungsi. Tidak ada dashboard admin, daftar member, revisi, rekap, atau export; itu memang Phase 2/5.
- **H:** Suite lengkap lulus setelah DB test disiapkan manual. Perintah `npm test` yang didokumentasikan tidak menyiapkan guard/DB dan gagal.

---

## 5. Langkah 4 — Verifikasi DB nyata

### 5.1 Migration dan schema

- Migration deploy pada DB dev: `No pending migrations to apply`.
- Migration pada DB test terisolasi berhasil.
- `information_schema` DB `absensi_dev`:

```text
tables (termasuk _prisma_migrations) = 13
foreign keys                         = 17
permissions                          = 27
users                                = 0
workspaces                           = 0
audit_logs                           = 0
engine/charset                       = InnoDB / utf8mb4
```

13 tabel terdiri dari 12 tabel DML + `_prisma_migrations`. Angka 17 FK berasal dari `information_schema.key_column_usage`; ini angka aktual query, bukan angka 13 dari laporan checkpoint.

### 5.2 Grant runtime

Akun runtime `absensi_app`:

- CRUD pada 11 tabel aplikasi.
- `audit_logs`: hanya `SELECT, INSERT` (tanpa `UPDATE`, `DELETE`).
- Awalnya user test hanya memiliki `USAGE`; grant harus diberikan **setelah** tabel dibuat. Grant sebelum migration menghasilkan `ER_DBACCESS_DENIED_ERROR`.

### 5.3 Probe DML langsung

Sebagai `absensi_app`:

| Probe | Hasil |
|---|---|
| `UPDATE audit_logs ...` | `ERROR 1142` — ditolak |
| `DELETE FROM audit_logs ...` | `ERROR 1142` — ditolak |
| `CREATE TABLE audit_probe ...` | `ERROR 1142` — ditolak |

Tidak ada tabel probe yang tertinggal. Baris probe dihapus. Ini membuktikan lapisan DB append-only bekerja, terpisah dari guard aplikasi.

**Catatan secret:** `SHOW GRANTS` mengeluarkan password verifier MySQL. Nilainya tidak disalin ke laporan.

---

## 6. Langkah 5 — Cross-tenant, audit, dan RBAC pada DB nyata

### 6.1 Yang lulus

Dengan DB test terisolasi dan grant yang benar, test service-level lulus untuk:

- `withTenant(ctxA).findMany` pada model tenant-scoped hanya mengembalikan baris A.
- `withTenant(ctxA)` pada model global `User` ditolak (`TenantModelAccessError`).
- `UPDATE`/`DELETE` baris tenant lain ditolak `CrossTenantAccessError`; baris B tetap utuh.
- `audit_logs` `UPDATE`/`DELETE` lewat `withTenant` ditolak `TenantAppendOnlyError`.
- Audit content: `tenant_id` non-null, actor benar, `ip_hash` 32 byte SHA-256, metadata sensitif menjadi `[REDACTED]`.
- Matrix RBAC 162 kombinasi dan katalog 27 permission lulus.

Ini adalah hasil test suite, bukan mock. Namun **pengujian dua sesi HTTP nyata** (user A login, user B login, A memanggil workspace B) tidak diulang secara independen dalam audit ini. Yang dibuktikan di level HTTP adalah route policy, 401 tanpa sesi, dan satu sesi login web. Untuk klaim HTTP cross-tenant dua-user, statusnya **TIDAK TERVERIFIKASI**, meskipun service-level test lulus.

### 6.2 Celah kritis yang ditemukan dengan probe nyata

Saya membuat dua workspace A/B dan satu membership di A, lalu menjalankan:

```ts
withTenant(ctxA, (db) =>
  db.workspaceMember.update({
    where: { id: memberA },
    data: { tenantId: B, status: "INACTIVE" },
  })
)
```

Hasil nyata:

```text
update_result=SUCCESS tenant_id_after=<tenant-B> status=INACTIVE
row_after=<tenant-B>:INACTIVE
```

Artinya `withTenant(ctxA)` **berhasil memindahkan baris milik A ke tenant B**. Extension hanya menggabungkan `where`; ia tidak membersihkan `data`. Ini persis batasan yang sudah didokumentasikan di `docs/TENANT-ISOLATION.md` §8, tetapi belum diperbaiki dan tidak tercakup test T5/T6.

Dampak: jika ada route/service Phase 2 yang meneruskan field `tenantId` dari input ke `data`, user A dapat memindahkan membership/role/record ke tenant B dan berpotensi memperoleh akses ke tenant B. Saat audit ini tidak ditemukan route HTTP Phase 1 yang meneruskan `tenantId` arbitrer ke `update`, jadi ini **CRITICAL laten**, bukan eksploitasi HTTP yang sudah terbukti. Namun kontrak library-nya tidak aman untuk Phase 2.

Batasan serupa yang masih terbuka: `upsert` tidak memaksa `create.tenantId`, nested write tidak melewati extension, dan `$queryRaw`/`$executeRaw` tidak difilter. Semuanya perlu ditutup atau dilarang dengan guard.

**Temuan C-01 (CRITICAL):** isolasi tenant belum tertutup pada mutasi `data`.

---

## 7. Langkah 6 — Perimeter keamanan

Server dijalankan dengan `NODE_ENV=production` di `127.0.0.1`, lalu respons nyata diambil dengan curl. Cookie dan token diredaksi.

### 7.1 Header keamanan

Respons `/api/health` dan `/api/workspaces` (401) memuat:

```text
content-security-policy: default-src 'self'; script-src 'self' 'unsafe-inline';
  style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self';
  connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self';
  frame-ancestors 'none'
cross-origin-opener-policy: same-origin
permissions-policy: camera=(), microphone=(), geolocation=(), payment=()
referrer-policy: strict-origin-when-cross-origin
strict-transport-security: max-age=31536000; includeSubDomains
x-content-type-options: nosniff
x-frame-options: DENY
cache-control: no-store
```

| Kontrol | Status | Bukti/catatan |
|---|---|---|
| CSP | **ADA** | Aktual; `script-src` masih `'unsafe-inline'`, belum nonce/hash |
| HSTS | **ADA di production** | Aktual `max-age=31536000; includeSubDomains`; TLS termination tidak diuji |
| `X-Content-Type-Options` | **ADA** | `nosniff` |
| `X-Frame-Options` / `frame-ancestors` | **ADA keduanya** | `DENY` dan `frame-ancestors 'none'` |
| `Referrer-Policy` | **ADA** | `strict-origin-when-cross-origin` |
| `Permissions-Policy` | **ADA** | Kamera/mikrofon/geolocation/payment dimatikan |
| `Cache-Control` API | **ADA** | `no-store` pada `/api/health`, `/api/auth/csrf`, `/api/workspaces` |
| `Cache-Control` halaman | **ADA pada halaman dinamis yang diuji** | `/sign-in` mendapat `private, no-cache, no-store, max-age=0, must-revalidate` dari Next; middleware hanya menambahkan untuk `/api/*` |
| `X-Powered-By` | **ADA (tidak diminta)** | `X-Powered-By: Next.js` masih terekspos; LOW |

### 7.2 Cookie dan session

Login web nyata menghasilkan:

```text
HTTP/1.1 200 OK
set-cookie: __Host-aos_session=<redacted>; Path=/; Max-Age=604800; HttpOnly; Secure; SameSite=lax
set-cookie: aos_csrf=<redacted>; Path=/; Max-Age=604800; Secure; SameSite=lax
body_contains_session_token=no
```

| Kontrol | Status | Bukti |
|---|---|---|
| Nama cookie produksi `__Host-` | **ADA** | `__Host-aos_session` aktual |
| `HttpOnly` | **ADA** | Aktual |
| `Secure` | **ADA** | Aktual (production) |
| `SameSite` | **ADA** | `Lax` |
| TTL 7 hari | **ADA** | `Max-Age=604800`; code/test |
| Idle timeout 24 jam | **ADA** | Code/test session |
| `last_seen_at` diperbarui | **ADA** | Code/test; maksimal sekali per jam |
| `rotateSession` saat privilege berubah | **TIDAK ADA pemicu** | Fungsi ada dan diuji langsung, tetapi tidak dipanggil saat role/privilege berubah; hanya test `auth.test.ts` yang memanggilnya |

`rotateSession()` tersedia di `session.ts` dan test unit lulus, tetapi tidak ada call site produksi saat privilege berubah. Ini adalah gap MEDIUM, bukan klaim “rotasi otomatis setiap request”.

### 7.3 CSRF dan login

- Web: double-submit cookie + header; login web nyata 200.
- `/api/auth/csrf` mengembalikan token di body dan cookie `aos_csrf`; cookie tidak `HttpOnly` (by design).
- **Mobile:** request dengan `content-type: application/json` dan `x-auth-mode: bearer` **tanpa** `Authorization` menghasilkan:

```text
HTTP/1.1 403 Forbidden
{"error":{"code":"CSRF_INVALID","message":"Token CSRF tidak valid"}}
```

Dengan `Authorization: Bearer dummy` (tanpa CSRF) login mengembalikan 200 dan body berisi token. Ini membuktikan `assertPublicCsrf()` tidak mengecualikan `X-Auth-Mode: bearer`; ia hanya mengecualikan keberadaan header `Authorization`. Kontrak mobile di `apps/mobile/README.md` dan `docs/PHASE-1.md` memakai `X-Auth-Mode`, sehingga flow resmi gagal.

**Temuan H-02 (HIGH):** login mobile sesuai kontrak menghasilkan 403; workaround `Authorization: Bearer dummy` bukan kontrak yang dapat diterima.

### 7.4 Rate limit login

- 10 percobaan / 15 menit per IP dan per akun; bucket terpisah.
- Fail-closed: error backend limiter → 503, bukan login lewat.
- Test B6 lulus.
- Limiter in-memory per proses; multi-instance belum aman.
- HTTP 429 tidak mengirim `Retry-After`; `retryAfterSeconds` dihitung di `rate-limit.ts` tetapi `HttpError`/`errorResponse` tidak membawanya. Ini bukan blocker Phase 1, tetapi klien tidak dapat backoff dengan benar.
- Per-IP bucket dapat di-spoof karena XFF; lihat 7.5.

### 7.5 Client IP / trusted proxy

`getClientIp()` mengambil alamat **paling kiri** dari `X-Forwarded-For`, lalu `X-Real-IP`. Source tidak membaca `TRUST_PROXY`; `.env.example` tidak mendokumentasikannya. `docs/PHASE-1.md` sendiri mencatat TD-1-R10.

Konsekuensi:

- Penyerang dapat mengirim XFF palsu untuk mengakali bucket rate limit per-IP.
- `ip_hash` audit dapat dipalsukan.
- Tanpa proxy yang menimpa header, tidak ada cara membedakan IP asli.

**Temuan H-03 (HIGH):** trusted-proxy handling belum ada; ini bukan sekadar “belum diuji”, melainkan tidak diimplementasikan.

### 7.6 Logger dan redaksi

- Test redaksi lulus untuk jalur login gagal, verifikasi password, koneksi DB gagal, dan metadata audit.
- Tidak ada secret yang terlihat pada output test yang diperiksa.
- Audit produksi/log jangka panjang tidak diuji; klaim “tidak ada secret di semua log produksi” **TIDAK TERVERIFIKASI**.

### 7.7 Route permission

Ada 11 file route `/api`:

```text
/api/health
/api/health/ready
/api/auth/csrf
/api/auth/login
/api/auth/register
/api/auth/me
/api/auth/logout
/api/workspaces
/api/workspaces/:id/members
/api/workspaces/:id/members/:memberId/role
/api/workspaces/:id/ownership/transfer
```

- Route publik yang dideklarasikan tepat 5: health, ready, csrf, login, register.
- Route workspace/member/role/ownership memakai `requirePermission` dengan permission `member.read`, `member.invite`, `role.manage`, `workspace.manage`.
- `GET/POST /api/workspaces` memakai `requireApiSession`; user hanya melihat/membuat workspace sendiri.
- Test route policy 2 lulus dan memastikan setiap method punya policy.
- Batasan test: test memindai deklarasi policy, bukan membuktikan handler benar-benar memanggil `requirePermission`. Pembacaan kode handler menunjukkan pemanggilan itu ada; ini cukup untuk audit ini, tetapi bukan jaminan otomatis untuk route baru.

---

## 8. Langkah 7 — Kesesuaian dengan flow tiga platform

### 8.1 Web admin (cookie)

- `/sign-in` 200; `/` 307 ke `/sign-in`; `/api/workspaces` tanpa sesi 401.
- Login web nyata berhasil dan cookie `__Host-aos_session` benar.
- Shell sign-in/out dan landing ada. Tidak ada dashboard admin, daftar member, approval revisi, rekap, atau export; itu Phase 2/5.
- Scoping tenant berasal dari `active_tenant_id` sesi; path workspace hanya klaim dan divalidasi `assertWorkspaceClaim`. Ini arah yang benar, tetapi dua sesi HTTP belum diuji.

### 8.2 Mobile (Bearer)

- Satu session store mendukung cookie dan Bearer; login dengan `Authorization` menghasilkan token di body, dan token tersebut dapat dipakai untuk Bearer.
- Namun login sesuai kontrak `X-Auth-Mode: bearer` **gagal 403 CSRF** (bukti di §7.3). Backend belum siap untuk flow mobile yang didokumentasikan.
- Tidak ada aplikasi Flutter di repo; `apps/mobile/README.md` adalah placeholder Phase 3. Ini sesuai jadwal, bukan kegagalan Phase 1.

### 8.3 Attendance dan correction request

Skema saat ini **belum memiliki**:

- `attendance_logs` (GPS, foto, timestamp, akurasi, mock-location flag),
- `correction_requests` (tanggal, alasan, bukti, status PENDING/APPROVED/REJECTED),
- tabel office/geofence (koordinat, radius), dan
- endpoint geofence/attendance/revisi.

Ini tidak dijadwalkan di Phase 1, jadi bukan pelanggaran lingkup. Namun tidak ada “tempat” domain yang sudah disiapkan; Phase 3/4 memerlukan migration additive. Tenant isolation dapat diterapkan dengan `tenant_id` pada tabel baru, tetapi **C-01 harus ditutup lebih dulu** agar data attendance/revisi tidak dapat dipindahkan antar-tenant.

### 8.4 Gap flow produk

| Flow yang diharapkan | Kondisi aktual | Status |
|---|---|---|
| Karyawan absen GPS + foto, server validasi geofence/accuracy/mock location | Belum ada model/endpoint | Phase 3 (belum dijadwalkan) |
| Karyawan ajukan revisi, admin approve/reject, attendance diperbarui + audit `{from,to}` | Belum ada model/endpoint/UI | Phase 4/5 |
| Admin memantau absensi/revisi ter-scope workspace | Belum ada UI; API member/role sudah ada | Phase 2 |
| Mobile Bearer | Ada secara parsial; login resmi gagal CSRF | **Gagal untuk kontrak saat ini** |
| Web cookie session | Ada dan teruji nyata | PASS |
| Satu session store | Ada (`sessions`), cookie + Bearer | PASS secara kode/test |

---

## 9. Tabel temuan

Severity: **CRITICAL** = dapat merusak isolasi/keamanan inti; **HIGH** = menghalangi klaim/Phase 2; **MEDIUM** = risiko nyata dengan mitigasi/kerja tambahan; **LOW** = kebersihan/operasional.

| ID | Severity | Ringkasan | Bukti | Dampak | Rekomendasi |
|---|---|---|---|---|---|
| **C-01** | **CRITICAL** | `withTenant` tidak membersihkan `data`; `update` dapat memindahkan baris ke tenant lain | Probe nyata: `update data {tenantId:B}` → `SUCCESS`, row menjadi tenant B; `tenant-db.ts` hanya `mergeWhere`; `TENANT-ISOLATION.md` §8 | A dapat memindahkan membership/role/record ke B dan berpotensi mengakses B; melanggar inti tenant isolation | Tolak `tenantId` di `data` update/updateMany/upsert; paksa create tenant; larang nested/raw untuk data tenant; tambah test regresi dua tenant |
| **H-01** | **HIGH** | Build checkout bersih gagal pada semua tag 1a–1f dan HEAD | `npm run build=2` semua tag; HEAD worktree `TS2375`; tag `TS2307 @absensi/permissions`; current build hanya karena `dist` lama | Tidak ada bukti setiap checkpoint dapat dibangun/di-deploy; CI tidak reproducible | Perbaiki urutan build workspace dan error TypeScript; jalankan clean-checkout build di CI untuk setiap tag/HEAD |
| **H-02** | **HIGH** | Login mobile `X-Auth-Mode: bearer` tanpa `Authorization` ditolak 403 CSRF | HTTP nyata: 403 `CSRF_INVALID`; dengan `Authorization: Bearer dummy` 200 + token; `assertPublicCsrf` hanya mengecualikan `Authorization` | Flow mobile resmi tidak berfungsi; integrasi Flutter Phase 3 akan gagal | Ubah `assertPublicCsrf` agar menerima mode bearer yang eksplisit, atau ubah kontrak mobile; tambah test HTTP mobile |
| **H-03** | **HIGH** | Tidak ada trusted-proxy; XFF paling kiri dipercaya | `getClientIp()` di `http.ts`; source tidak membaca `TRUST_PROXY`; `PHASE-1.md` TD-1-R10 | Rate limit per-IP dan `ip_hash` audit dapat di-spoof; respons insiden tidak dapat dipercaya | Implementasi `TRUST_PROXY=false` default-deny, hanya rightmost XFF di belakang proxy tepercaya; dokumentasikan di `.env.example` |
| **H-04** | **HIGH** | `npm test` yang didokumentasikan gagal tanpa setup DB guard | `npm test` exit 1; 53 auth gagal `S1_TEST_DB_GUARD=1 wajib`; database cleanup `TypeError`; 105 lulus hanya setelah DB test + grant | Test suite tidak bisa dijalankan oleh CI/ reviewer baru; klaim verifikasi tidak reproducible | Sediakan skrip test DB terisolasi + grant; jadikan guard bagian dari setup; dokumentasikan satu perintah yang benar |
| **M-01** | MEDIUM | Tidak ada tag `checkpoint-1g`/`1h`; G/H tidak dapat diverifikasi sebagai checkpoint | `git tag -l` hanya 1a–1f; G adalah commit `61e1398`; H tidak punya tag | Klaim “setiap checkpoint” tidak lengkap; audit trail Phase 1 tidak konsisten | Buat tag yang benar atau koreksi klaim; jangan menyebut checkpoint yang tidak ada |
| **M-02** | MEDIUM | `rotateSession` tidak dipanggil saat privilege berubah | Fungsi ada di `session.ts`; hanya test yang memanggil; docs D-1-9 menyatakan role change tidak revoke session | Token lama tetap berlaku setelah perubahan privilege; rotasi hanya teoritis | Panggil rotasi/revoke pada perubahan role/privilege yang relevan; uji session lama |
| **M-03** | MEDIUM | CSP mengizinkan `script-src 'unsafe-inline'` | `security-headers.ts`; header aktual | XSS mitigation lebih lemah dari klaim CSP ketat | Tambahkan nonce/hash untuk bootstrap Next; hapus `unsafe-inline` bila memungkinkan |
| **M-04** | MEDIUM | Audit best-effort dapat hilang saat DB/log gagal | `writeAudit`; docs TD-1-R14; grant append-only hanya menjamin immutability, bukan delivery | Kejadian keamanan/audit bisa tidak tercatat | Outbox/retry atau fail-closed untuk aksi berisiko; monitor kegagalan audit |
| **M-05** | MEDIUM | Rate limit in-memory dan 429 tanpa `Retry-After` | `rate-limit.ts` menghitung `retryAfterSeconds`; HTTP error response tidak membawanya; docs TD-1-R8 | Multi-instance tidak konsisten; klien tidak bisa backoff tepat | Gunakan store bersama; teruskan `Retry-After` pada 429 |
| **M-06** | MEDIUM | Test B7 “wrong CSRF” tidak benar-benar menguji mismatch | Test memakai cookie/header yang sama; bukan bypass proof | Rasa aman palsu pada CSRF; regresi tidak tertangkap | Buat test cookie dan header berbeda; uji route login/register nyata |
| **M-07** | MEDIUM | Invitation token dikembalikan di respons API | `workspaces.ts`; docs TD-1-R11 | Token dapat tersimpan di log/client; belum ada email/accept | Kirim via kanal aman; jangan log; selesaikan accept flow Phase 2 |
| **L-01** | LOW | `X-Powered-By: Next.js` terekspos | Header curl aktual | Fingerprinting framework | Matikan `poweredByHeader` di Next config |
| **L-02** | LOW | Tidak ada switcher workspace; `active_tenant_id` selalu workspace pertama | docs TD-1-R12/R13; UI landing | Admin multi-workspace belum dapat berpindah tenant | Tambah endpoint/UI switch dengan validasi membership |
| **L-03** | INFO | Hash `install.sh` aktual tidak cocok dengan prefix `c9...` yang dilaporkan | `sha256=c73dad...493214`; suffix cocok, prefix tidak | Klaim integritas berbasis hash pembanding tidak dapat dikonfirmasi | Simpan hash acuan resmi dan bandingkan penuh; konfirmasi apakah `install.sh` memang milik proyek |

### Temuan yang tidak dimasukkan sebagai bug

- 13 tabel vs klaim “12 tabel”: 12 adalah tabel DML; `_prisma_migrations` adalah tabel metadata. Bukan pelanggaran.
- `Cache-Control` halaman: middleware hanya mengatur API, tetapi halaman dinamis yang diuji sudah mendapat `no-store` dari Next. Untuk halaman yang diuji, kontrol terpenuhi.
- `audit_logs` tanpa FK ke workspace: keputusan D-1-3 untuk mempertahankan audit setelah workspace dihapus. Bukan bug dengan sendirinya.

---

## 10. Verdict dan penilaian

### Verdict: **PARTIAL (78%)**

Alasan berbasis bukti:

- **Yang sudah kuat:** 105 test lulus pada DB nyata setelah setup yang benar; 27 permission/6 role/162 matrix; grant append-only dan probe `1142`; header keamanan aktual; cookie `__Host-` produksi; route policy 11 route; service-level tenant read/update/delete normal dan audit redaction.
- **Yang mencegah SELESAI:** C-01 adalah celah tenant kritis; H-01 membuat klaim buildability tidak sah; H-02 membuat flow mobile resmi gagal; H-03 membuat perimeter IP tidak dapat dipercaya; H-04 membuat test suite tidak reproducible.
- **Yang belum dijadwalkan:** attendance/GPS/foto/geofence, correction request, admin dashboard, export, Flutter. Ini tidak dihitung sebagai kegagalan Phase 1, tetapi menjadi gap Phase 2–4.

Persentase 78% adalah penilaian audit, bukan skor resmi proyek: implementasi permukaan A–H sudah luas, tetapi gate keamanan tenant, build, dan perimeter belum memenuhi syarat “selesai”.

### Status per komponen

| Komponen | Nilai audit |
|---|---|
| A. Database & tenant | 8/10 — DB/grant kuat; C-01 kritis |
| B. Auth & session | 7.5/10 — web kuat; mobile CSRF dan proxy IP gagal |
| C. RBAC | 10/10 — katalog/matrix/route policy konsisten |
| D. Workspace/member | 8.5/10 — service test kuat; HTTP dua-sesi belum diulang |
| E. Audit | 9/10 — append-only kuat; delivery best-effort |
| F. Headers/logger | 9/10 — header aktual; CSP `unsafe-inline` |
| G. Web shell/mobile placeholder | 8/10 — shell sesuai Phase 1; admin belum ada (sesuai jadwal) |
| H. Test suite | 6/10 — 105 lulus dengan setup manual; `npm test`/clean build gagal |

---

## 11. Lampiran perintah bukti utama

### 11.1 Repo dan integritas

```bash
cd /home/reksa/absen-solusi/app
pwd
git status --porcelain
git log --oneline --all --decorate
git tag -l
git remote -v
git branch -vv
git ls-files | grep -i devdb
git log --all --oneline -- .devdb
git rev-list --objects --all | grep -i devdb
git log --all --full-history -- .env
stat -c 'size=%s mode=%a mtime=%y' /home/reksa/absen-solusi/install.sh
sha256sum /home/reksa/absen-solusi/install.sh
```

### 11.2 Build per tag

```bash
# untuk setiap tag checkpoint-1a..checkpoint-1f
git worktree add --detach /tmp/audit-wt <tag>
cd /tmp/audit-wt
npm ci
npm run build; echo "build=$?"
npm run typecheck; echo "typecheck=$?"
npm test; echo "test=$?"
cd /home/reksa/absen-solusi/app
git worktree remove --force /tmp/audit-wt
```

### 11.3 DB dan grant

```bash
# migration
npx prisma migrate deploy

# schema
mariadb --socket=/tmp/audit-mysqld.sock -u root -D absensi_dev -e "
SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='absensi_dev';
SELECT COUNT(*) FROM information_schema.key_column_usage
 WHERE table_schema='absensi_dev' AND referenced_table_name IS NOT NULL;
SELECT COUNT(*) FROM permissions;
"

# grant runtime (ringkasan; output password verifier tidak disalin)
SHOW GRANTS FOR 'absensi_app'@'localhost';

# probe (sebagai absensi_app)
UPDATE audit_logs SET action='probe' LIMIT 1;
DELETE FROM audit_logs LIMIT 1;
CREATE TABLE audit_probe (id INT);
```

### 11.4 Probe tenant kritis

```ts
withTenant(ctxA, (db) =>
  db.workspaceMember.update({
    where: { id: memberA },
    data: { tenantId: B, status: "INACTIVE" },
  })
)
```

Hasil aktual: `SUCCESS`; baris pindah ke tenant B. Baris probe kemudian dihapus.

### 11.5 HTTP perimeter

```bash
cd /home/reksa/absen-solusi/app/apps/web
NODE_ENV=production ../../node_modules/.bin/next start -H 127.0.0.1 -p 3100
curl -sS -D - http://127.0.0.1:3100/api/health
curl -sS -D - http://127.0.0.1:3100/sign-in
curl -sS -D - http://127.0.0.1:3100/api/auth/csrf   # cookie/token diredaksi
curl -sS -D - http://127.0.0.1:3100/api/workspaces
```

### 11.6 Test

```bash
# dengan DB test terisolasi + grant setelah migration
npm test

# perintah tanpa guard: terbukti exit 1
npm test
npm test --workspace @absensi/web
```

Hasil yang tercatat: `105 pass` dengan DB test (auth 73, database 21, web 2, permissions 9); `npm test` tanpa guard `exit 1` (53 auth gagal, permissions 9 lulus); test route web 2 lulus.

---

## 12. Pernyataan penutup

- **`/home/reksa/affiliateos` tidak disentuh.** Tidak ada pembacaan, pencarian, perubahan, atau referensi.
- **`/home/reksa/absen-solusi/install.sh` tidak diubah.** Hash aktual `c73dad...493214`; suffix cocok, prefix pembanding `c9...` tidak cocok dan tidak dapat dikonfirmasi.
- **Tidak ada commit, push, stash, revert, rebase, atau perubahan source.** Hanya dokumen audit ini yang ditulis.
- **Tidak ada secret yang dicetak.** Password verifier dari `SHOW GRANTS` dan semua token/cookie/password diredaksi.
- **Batas yang tidak terverifikasi:** dua sesi HTTP cross-tenant, TLS termination/remote proxy, deployment VPS, pengiriman email undangan, aplikasi Flutter, dan audit log produksi jangka panjang.

**Kesimpulan:** Phase 1 memiliki fondasi yang cukup luas dan banyak test nyata yang lulus, tetapi belum boleh dinyatakan SELESAI. Status yang dapat dipertanggungjawabkan adalah **PARTIAL (78%)**, dengan C-01 sebagai blocker kritis sebelum pekerjaan Phase 2 yang menyentuh data tenant.
