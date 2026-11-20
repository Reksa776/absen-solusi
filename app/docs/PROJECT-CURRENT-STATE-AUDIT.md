# PROJECT CURRENT STATE AUDIT — Aplikasi Absensi GPS + Foto

**Tanggal audit:** 2026-11-19
**Auditor:** Buffy (Senior Software Architect / Backend / Flutter / DB / Security Auditor)
**Mode:** READ-ONLY. Tidak ada perubahan source code, schema, migration, database, environment, dependency, atau Git.
**Lokasi repo:** `/home/reksa/absen-solusi/app` (git root ada di `app/`, bukan di direktori induk)
**Roadmap acuan:** LOCKED ROADMAP Phase 1–8 (tidak diubah oleh audit ini)

> **Penting tentang istilah status.** Kolom `Status` menilai **kelengkapan implementasi**
> berdasarkan pembacaan kode + artefak + test yang benar-benar dieksekusi. Kolom `Bukti`
> menyatakan apa yang diverifikasi. Status PASS **bukan** klaim bahwa seluruh test lulus:
> 45 test yang membutuhkan MariaDB tidak dieksekusi pada audit ini (lihat §10) karena
> database dev berhenti dan aturan audit melarang mengubah database.

---

## 1. Executive Summary

Proyek ini **bukan aplikasi absensi yang sudah berjalan**. Yang benar-benar ada adalah
**fondasi platform Phase 1** (auth, session, CSRF, RBAC, multi-tenant, workspace,
invitation, audit) di atas Next.js + Prisma + MariaDB, dengan **nol fitur absensi**.

Temuan utama:

1. **Phase 1 terimplementasi, tetapi belum benar-benar "bersih".** Komponen A–G lengkap
   dan konsisten; komponen H (test suite) lengkap sebagai kode, namun 45 dari 57 test
   bergantung pada DB dan tidak dapat direproduksi pada audit ini. Dokumentasi
   `docs/PHASE-1.md` juga **belum di-commit** dalam bentuk klaim "selesai": versi yang
   ter-commit masih menyatakan "BELUM SELESAI".
2. **Phase 2 belum dimulai secara substansi.** Dari 7 task, hanya 1 PARTIAL
   (dokumentasi semantik `withTenant` yang masih berupa JSDoc), 6 NOT STARTED.
   Tidak ada `GET /api/workspaces`, tidak ada member list API, tidak ada
   accept-invitation, tidak ada `/api/health/ready`, tidak ada rate limit per-user,
   tidak ada UI workspace/member, tidak ada pengaturan kantor.
3. **Blocker arsitektural paling serius:** katalog RBAC dan 6 role yang di-seed adalah
   **domain aplikasi affiliate marketing** (`creator.*`, `campaign.*`, `shop.*`,
   `outreach.*`, role `AFFILIATE_MANAGER`, `BUSINESS_DEVELOPMENT`). Tidak ada satu pun
   permission/role untuk absensi (`attendance.*`, `correction.*`, `report.*`) maupun
   role `EMPLOYEE`/`HR`. Phase 3 tidak dapat menegakkan otorisasi karyawan tanpa
   memperbaiki ini terlebih dahulu.
4. **Temuan keamanan High/Critical:** aktor dengan `role.manage` dapat menaikkan role
   siapa pun menjadi `WORKSPACE_OWNER` atau menurunkan owner yang ada (tidak ada
   hierarki role, tidak ada perlindungan "last owner"); `X-Forwarded-For` dipercaya
   tanpa allowlist sementara `TRUST_PROXY` di `.env` tidak dipakai; rate limit hanya
   ada di login.
5. **Bug fungsional nyata:** password yang melanggar kebijakan menghasilkan
   **HTTP 500**, bukan 400, karena `PasswordPolicyError` tidak dipetakan ke `HttpError`.
6. **Flutter belum ada sama sekali** — hanya `apps/mobile/README.md`, tanpa `pubspec.yaml`,
   tanpa kode Dart.

**Kesimpulan:** checkpoint terakhir yang dapat dinyatakan PASS adalah **Phase 1
Checkpoint 7F (komponen F/H)**, dengan catatan evidence test DB. Phase 2 belum memiliki
checkpoint yang PASS. Pekerjaan berikutnya adalah **Phase 2 task 2.1/2.3/2.5**, bukan
melompat ke Phase 3.

---

## 2. Repository Information

| Item | Nilai |
|---|---|
| Git root | `/home/reksa/absen-solusi/app` (direktori induk **bukan** git repo) |
| Remote | Tidak ada (`git remote -v` kosong) |
| Branch | `main` |
| Total commit | 7 |
| Monorepo | npm workspaces: `apps/*`, `packages/*` |
| Runtime Node | `v26.13.0` (engine `>=24.0.0`) |
| npm | `11.20.0` |
| Database | MariaDB dev user-space di `app/.devdb/` (port 3307), **sedang berhenti** |
| CI/CD | Tidak ada (tidak ada workflow, Dockerfile, atau pipeline) |
| Lint | Tidak ada konfigurasi lint |

Struktur aktual:

```
app/
├── apps/
│   ├── web/       Next.js 16.4.6 App Router (TS), 9 route /api, 2 halaman
│   ├── worker/    placeholder (console.log, tanpa DB/job)
│   └── mobile/    HANYA README — belum ada proyek Flutter
├── packages/
│   ├── auth/      password, session, csrf, rate-limit, http, users, workspaces,
│   │              logger, security-headers, route-policy (+ test)
│   ├── database/  Prisma client, tenancy, tenant-db, rbac, audit, health (+ test)
│   └── permissions/ katalog 27 permission, 6 role, matriks role→permission
├── docs/          PHASE-1.md (+ 2 dokumen audit ini)
├── .devdb/        MariaDB dev (gitignored)
└── .env           (gitignored)
```

Dependency utama: `next@16.4.6`, `react@19.3.1`, `@prisma/client@7.10.1`,
`@prisma/adapter-mariadb@7.10.1`, `mariadb@^3.5.2`, `@node-rs/argon2@2.2.2`,
`typescript@7.0.2`.

---

## 3. Git Status

| Aspek | Kondisi |
|---|---|
| HEAD | `47e77c0527a4510c23d31017e78feaacdd978fd2` |
| Pesan HEAD | `feat(security): headers middleware, redacting logger, bundler-safe env load (P1 F)` |
| Tanggal HEAD | 2026-11-18 09:54:21 +0700 |
| Stash | Kosong |
| Remote | Tidak ada |

Working tree **tidak bersih**:

| Status | File |
|---|---|
| `M` (staged) | `apps/web/next-env.d.ts` |
| `M` (staged) | `apps/web/src/app/page.tsx` |
| `A` (staged) | `apps/web/src/app/sign-in/page.tsx` |
| `A` (staged) | `apps/web/src/app/sign-in/sign-in-form.tsx` |
| `A` (staged) | `apps/web/src/app/sign-out-button.tsx` |
| ` M` (unstaged) | `docs/PHASE-1.md` |
| `??` (untracked) | `packages/auth/src/route-policy.test.ts` |

Implikasi:

- Pekerjaan **Phase 1 G (web shell) dan dokumen status Phase 1 belum di-commit**.
  Checkout/clone bersih dari HEAD akan kehilangan halaman `/sign-in`, tombol sign-out,
  landing page baru, dan test route policy di paket auth.
- Versi `docs/PHASE-1.md` yang ter-commit masih berisi "**BELUM SELESAI** — hanya
  komponen A"; versi working tree menyatakan A–H selesai. Ini adalah **drift dokumentasi
  paling berbahaya** di repo: pembaca HEAD akan menyimpulkan proyek lebih mundur,
  sedangkan pembaca working tree akan menyimpulkan lebih maju daripada evidence test
  yang dapat direproduksi.
- Tidak ada perubahan yang di-reset/stash/checkout oleh audit ini; seluruh perubahan
  lokal dipertahankan apa adanya.

Riwayat commit (7):

```
47e77c0 feat(security): headers middleware, redacting logger, bundler-safe env load (P1 F)
49ea9ac test(audit): five required actions with actor, ip_hash, token-free metadata (P1 E)
1d43473 test(workspace): provisioning, invitation, role change, cross-tenant isolation (P1 D)
49a9e91 test(rbac): 162-combination permission matrix on real DB (P1 C)
10943df feat(auth): session store, CSRF, rate limit, API routes (P1 B; C/D infra)
b9c52bc feat(db): M1 foundation, tenant isolation, audit append-only (P1 A)
a0d46a3 chore: scaffold monorepo absensi
```

---

## 4. Architecture Overview

### 4.1 Lapisan

```
apps/web (Next.js Route Handlers + 2 halaman server component)
        │  imports @absensi/auth (HTTP guard, services) dan @absensi/database
        ▼
packages/auth     password · session · csrf · rate-limit · http · users · workspaces
        │         logger · security-headers · route-policy
        ▼
packages/database Prisma client · tenancy (branded ctx) · withTenant extension
        │         rbac (resolve permissions) · audit (append-only writer) · health
        ▼
MariaDB (12 tabel, 1 migration, grant append-only audit_logs)
```

- **Satu session store** (`sessions`) melayani cookie web dan Bearer mobile.
- **Tenant authority** berasal dari `sessions.active_tenant_id`, bukan dari URL.
  `:workspaceId` hanya "klaim" dan dibandingkan di `assertWorkspaceClaim()`.
- **`withTenant(ctx)`** adalah Prisma client extension: filter `tenant_id`/`id`
  ditimpa (bukan digabung), `create` dipaksa tenant context, model di luar allowlist
  ditolak, dan `audit_logs` menolak update/delete di level aplikasi.
- **`systemDb()`** adalah escape hatch unscoped dengan komentar `SYSTEM:` wajib.
  Call site terverifikasi: `session.ts` (session/lookup), `http.ts` (membership +
  permission resolution), `users.ts` (bootstrap/login), `workspaces.ts` (provisioning
  sebelum tenant ada), `audit.ts` (writer), `apps/web/.../me/route.ts` dan
  `apps/web/src/app/page.tsx` (data user untuk sesi tervalidasi).
- **`permissions`** adalah paket murni (tanpa DB) yang menjadi sumber kebenaran
  katalog dan matriks role.
- **Worker** belum terhubung ke apa pun.

### 4.2 Catatan arsitektur

| Kekuatan | Kelemahan |
|---|---|
| Tenant context branded + tidak bisa dibuat tanpa membership terverifikasi | `withTenant` **opt-in**; tidak ada enforcement kompilasi bahwa service memakainya |
| `systemDb()` terdokumentasi dan sedikit | Tidak ada test yang memastikan tidak ada `systemDb()` baru tanpa alasan |
| Satu jalur audit writer | Audit best-effort (kegagalan ditelan) |
| Route policy registry dipindai oleh test | Registry **per-path**, bukan per-method (lihat TD-2-R8) |
| Permission matrix diuji 162 kombinasi | Matriks berisi domain affiliate, bukan absensi |

---

## 5. Database Status

### 5.1 Skema (12 tabel)

| Tabel | Fungsi | Catatan integritas |
|---|---|---|
| `users` | akun global | `email` unique |
| `sessions` | session web + mobile | `token_hash` unique CHAR(64); FK user cascade |
| `workspaces` | tenant | `slug` unique |
| `workspace_members` | membership | unique `(tenant_id,user_id)`, unique `(tenant_id,id)` |
| `roles` | role per tenant | unique `(tenant_id,key)` |
| `permissions` | katalog global 27 baris | PK `key` |
| `role_permissions` | grant role→permission | PK gabungan; FK komposit ke `roles(tenant_id,id)` |
| `member_roles` | assignment role ke member | PK gabungan; FK komposit ke member & role |
| `workspace_invitations` | undangan | `token_hash` unique; FK komposit role |
| `audit_logs` | audit append-only | tenant_id **tanpa FK** (by design); 2 index |
| `background_jobs` | antrean job | `idempotency_key` unique |
| `background_job_attempts` | riwayat attempt | FK job cascade |

Tidak ada tabel: `office_locations`, `attendance_logs`, `correction_requests`,
`holidays`, `shifts`, `overtime`, `notifications`. Artinya Phase 3–7 **belum memiliki
model data sama sekali**.

### 5.2 Migration & grant

- Migration history: **1** — `20261118090000_m1_foundation`. Tidak ada migration tertunda
  yang terlihat, tetapi status "applied" **tidak diverifikasi runtime** (DB berhenti).
- Migration membuat 12 tabel + seed 27 permission.
- `prisma/grants.sql` mencabut semua privilege lalu memberi DML penuh ke 11 tabel dan
  **SELECT+INSERT saja** ke `audit_logs`, untuk dua host (`127.0.0.1`, `localhost`).
- Grant bersifat **manual**, bukan bagian migration/trigger. Environment yang tidak
  menjalankan `grants.sql` kehilangan jaminan append-only di level DB (lihat TD-2-R6).

### 5.3 Data integrity / isolation

- Semua child tenant memakai FK komposit `(tenant_id, id)` sehingga baris lintas tenant
  tidak dapat direferensikan secara struktural. Ini desain yang kuat.
- `sessions.active_tenant_id` **tidak** memiliki FK ke `workspaces`; tenant yang dihapus
  menyisakan nilai menggantung (mitigasi: `requirePermission` gagal 403 karena membership
  hilang).
- `audit_logs.tenant_id` tanpa FK adalah keputusan sadar (D-1-3) agar audit bertahan
  setelah workspace dihapus.
- Tidak ada index untuk `audit_logs.actor_user_id` / `resource_id` (query forensik
  per-aktor akan full scan pada volume besar). Severity rendah untuk MVP.

---

## 6. Backend Status

### 6.1 Endpoint yang ada (9 route, terverifikasi dari file)

| Method | Path | Auth | Policy registry | Kondisi |
|---|---|---|---|---|
| GET | `/api/health` | publik | public (liveness) | Statis `{status:"ok"}`; **tidak** menyentuh DB |
| GET | `/api/auth/csrf` | publik | public | Menerbitkan token double-submit |
| POST | `/api/auth/register` | publik (bootstrap) | public | Hanya bila `ALLOW_REGISTRATION=true` **dan** tabel `users` kosong |
| POST | `/api/auth/login` | publik | public | CSRF wajib mode cookie; rate limit per IP + akun |
| POST | `/api/auth/logout` | session | authenticated | Mencabut sesi aktif |
| GET | `/api/auth/me` | session | authenticated | User + `activeTenantId` + daftar workspace + mode |
| POST | `/api/workspaces` | session | authenticated | Create workspace + 6 role + owner, atomik |
| POST | `/api/workspaces/:id/members` | session + `member.invite` | permission | Invite by email; token dikembalikan di body |
| PATCH | `/api/workspaces/:id/members/:memberId/role` | session + `role.manage` | permission | Ganti role; self-change ditolak |

**Tidak ada** endpoint: `GET /api/workspaces`, `GET .../members`, accept-invitation,
switch tenant, readiness, absensi, revisi, laporan, export, notifikasi.

### 6.2 Service layer

| Fungsi | File | Verifikasi |
|---|---|---|
| `hashPassword` / `verifyPassword` | `packages/auth/src/password.ts` | Argon2id m=19456,t=2,p=1; test B1 lulus |
| `createSession` / `validateSession` / `rotateSession` | `packages/auth/src/session.ts` | Hash token SHA-256, TTL 7 hari, idle 24 jam, throttle 1 jam |
| `requirePermission` | `packages/auth/src/http.ts` | Resolve membership + permission dari DB tiap request |
| `registerBootstrap` / `loginWithPassword` | `packages/auth/src/users.ts` | Bootstrap atomik; login audit |
| `createWorkspace` / `inviteMember` / `changeMemberRole` | `packages/auth/src/workspaces.ts` | Transaksi; claim 404 identik; audit |
| `withTenant` | `packages/database/src/tenant-db.ts` | Extension allowlist + override tenant |
| `writeAudit` | `packages/database/src/audit.ts` | Redaksi metadata, `ip_hash` 32 byte |
| `checkDatabaseHealth` | `packages/database/src/health.ts` | **Tidak dipakai siapa pun** (calon readiness) |

### 6.3 Validasi, error, transaksi, audit

- Validasi input: `requireString` (trim + max), `assertEmail`, `assertName`,
  `assertRoleKey`, `readJsonBody` (objek JSON). Tidak ada validasi ukuran body.
- Pemetaan error: hanya `HttpError` yang dipetakan rapi. `PasswordPolicyError`,
  `CrossTenantAccessError`, `TenantContextError`, `AuditInputError` akan menjadi **500**.
- Transaksi: create workspace, bootstrap register, role change (upsert lalu delete)
  memakai `$transaction` dengan benar.
- Audit: 5 aksi (`auth.register_bootstrap`, `auth.login`, `workspace.create`,
  `member.invite`, `role.change`), best-effort, metadata diredaksi.
- Tidak ada pagination di mana pun (belum relevan karena belum ada list endpoint).

---

## 7. Web Application Status

| Halaman/komponen | File | Kondisi |
|---|---|---|
| `/sign-in` | `apps/web/src/app/sign-in/page.tsx` | Server component; redirect ke `/` bila sesi valid |
| Form login | `apps/web/src/app/sign-in/sign-in-form.tsx` | Client component; ambil CSRF cookie/endpoint, POST login, error alert, busy state |
| Landing | `apps/web/src/app/page.tsx` | Menampilkan user, workspace aktif, slug, role; tombol keluar |
| Sign out | `apps/web/src/app/sign-out-button.tsx` | POST logout dengan header CSRF |

Belum ada: workspace list/switcher, member list, invitation form, halaman accept
invitation, pengaturan kantor, dashboard admin, navigasi, layout responsif, komponen
loading/error terstandar. Styling memakai inline style, tanpa design system.

Catatan: halaman **tidak** memeriksa `workspace.status`; bila workspace disuspend,
landing masih menampilkan sebagai aktif sampai login berikutnya.

---

## 8. Flutter Application Status

- `apps/mobile/` hanya berisi `README.md`. Tidak ada `pubspec.yaml`, `lib/`, test,
  Android/iOS project, atau toolchain Dart di repo.
- README mendokumentasikan kontrak Bearer (login `X-Auth-Mode: bearer`, simpan token di
  secure storage, kirim `Authorization`) — kontrak backend-nya nyata dan sudah ada.
- Tidak ada permission GPS/kamera, tidak ada `geolocator`/`camera`, tidak ada state
  management, tidak ada offline queue.
- **Semua task Flutter (3.8, 4.7) NOT STARTED.**

---

## 9. Security Audit

### 9.1 Kontrol yang terbukti baik

| Kontrol | Bukti |
|---|---|
| Password Argon2id + kebijakan panjang | `password.ts`; test B1 (lulus) |
| Token sesi di-hash SHA-256, bukan plaintext | `session.ts`; skema `token_hash` |
| CSRF double-submit constant-time | `csrf.ts`, `http.ts::assertCsrf`; F/H lulus, B7 (kode) |
| Cookie produksi `__Host-` + HttpOnly + Secure | `http.ts::sessionCookie` |
| Tenant isolation dari sesi, URL hanya klaim | `http.ts::requirePermission`, `workspaces.ts::assertWorkspaceClaim` |
| 404 identik untuk workspace asing vs tidak ada | D5 (kode test) |
| Security headers + CSP + no-store API | `security-headers.ts`, `middleware.ts`; F1/F2 lulus |
| Redaksi log (Bearer, cookie, Argon2, SHA-256) | `logger.ts`; F3–F5 lulus |
| Audit metadata tanpa token/hash | `audit.ts::sanitizeMetadata`; E1/B14 (kode test) |
| Tidak ada raw SQL di kode produk | pencarian `$queryRawUnsafe`/`$executeRawUnsafe` hanya di test |

### 9.2 Temuan

| ID | Severity | Temuan | Bukti | Dampak | Rekomendasi |
|---|---|---|---|---|---|
| S-1 | **Critical** | Eskalasi privilege lewat role management: aktor dengan `role.manage` dapat mengubah member lain menjadi `WORKSPACE_OWNER`, atau menurunkan owner yang ada. Tidak ada hierarki role maupun proteksi "last owner". `inviteMember` juga menerima `role: "WORKSPACE_OWNER"` | `workspaces.ts::changeMemberRole` (hanya blok self-change), `assertRoleKey` menerima semua role, `ROLE_PERMISSIONS.WORKSPACE_OWNER = ALL_PERMISSIONS` | Admin dapat mengambil alih workspace; pemilik asli kehilangan akses | Larang pemberian role dengan permission superset dari aktor; larang demote owner terakhir; batasi `role.manage` ke OWNER; audit penolakan |
| S-2 | **High** | RBAC memakai domain affiliate (`creator`, `campaign`, `shop`, `outreach`, `AFFILIATE_MANAGER`, `BUSINESS_DEVELOPMENT`); tidak ada permission/role absensi | `packages/permissions/src/index.ts`; seed migration | Phase 3 tidak bisa mengotorisasi karyawan/HR; admin terlalu luas | Definisikan ulang katalog untuk domain absensi sebelum Phase 3 (TD-2-R1) |
| S-3 | **High** | Rate limit hanya pada login. `POST /api/workspaces`, invite, role change, dan register tidak dibatasi | `rate-limit.ts` hanya dipakai `users.ts::loginWithPassword` | Spam workspace (≈6 role + ±100 role_permission per call) → pembengkakan DB/DoS; spam undangan | Terapkan limiter per-user + per-tenant pada route workspace (task 2.4) |
| S-4 | **High** | `X-Forwarded-For` dipercaya tanpa allowlist proxy; `TRUST_PROXY` ada di `.env` tetapi **tidak dibaca kode** | `http.ts::getClientIp`; grep `TRUST_PROXY` = 0 hasil di source | Bypass rate limit per-IP; `ip_hash` audit dapat dipalsukan | Hanya percaya XFF bila `TRUST_PROXY` aktif dan peer tepercaya; dokumentasikan |
| S-5 | **Medium** | Integritas audit: penulisan best-effort (gagal ditelan), dan append-only hanya dijaga `grants.sql` manual | `workspaces.ts::safeAudit`, `users.ts::safeAudit`, `grants.sql` | Aksi sukses tanpa jejak audit; environment tanpa grant bisa mengubah audit | Outbox audit dalam transaksi yang sama; jadikan grant bagian prosedur deploy/CI (TD-2-R6) |
| S-6 | **Medium** | Status workspace tidak diperiksa per request; sesi tetap sah setelah workspace disuspend | `http.ts::requirePermission` hanya cek membership `ACTIVE` | Akses berlanjut pada tenant yang seharusnya nonaktif | Tambahkan filter `workspace.status = ACTIVE` (TD-2-R3) |
| S-7 | **Medium** | Password lemah → **HTTP 500**, bukan 400 | `registerBootstrap` memanggil `hashPassword` yang melempar `PasswordPolicyError`; `handleRouteError` hanya memetakan `HttpError` | UX buruk, log error palsu, kontrak API salah | Petakan `PasswordPolicyError` → 400 `INVALID_PASSWORD`; tambah test route |
| S-8 | **Medium** | Rate limiter in-memory per proses | `MemoryRateLimiter` | Multi-instance/deploy horizontal = bypass; state hilang saat restart | Store bersama (DB/Redis) — TD-1-R8 |
| S-9 | **Medium** | Tidak ada batas ukuran body JSON | `http.ts::readJsonBody` | Body besar → memori/CPU | Batasi `content-length` dan ukuran field |
| S-10 | **Low** | Password di-`trim()` oleh `requireString` | `http.ts::requireString` dipakai untuk `password` di login/register | Spasi awal/akhir password hilang diam-diam | Validasi password tanpa trim (fungsi khusus) |
| S-11 | **Low** | User enumeration lewat timing login (Argon2 hanya dijalankan bila user ada) | `users.ts::loginWithPassword` | Penyerang dapat membedakan email terdaftar | Verifikasi dummy hash saat user tidak ada |
| S-12 | **Low** | Dokumentasi mengklaim rotasi sesi saat privilege berubah, tetapi `rotateSession` tidak dipanggil di kode produk | `session.ts` + test B11; grep call site | Ekspektasi keamanan tidak terpenuhi; dokumentasi menyesatkan | Panggil `rotateSession` saat role berubah **atau** perbaiki dokumen |
| S-13 | **Low** | Config drift: `.env.example` hanya memuat `DATABASE_URL` + `NODE_ENV`; `APP_DATABASE_URL`, `ALLOW_REGISTRATION`, `TRUST_PROXY`, `ENABLE_PERMISSION_PROBE` tidak terdokumentasi, dua yang terakhir tidak dipakai kode | `.env.example`, `.env` (key saja), grep | Setup baru gagal/kacau; env mati menyesatkan | Sinkronkan `.env.example`; hapus env yang tidak dipakai |
| S-14 | **Low** | Token undangan dikembalikan di respons API; belum ada accept/email; masa berlaku 7 hari | `workspaces.ts::inviteMember` | Token dapat bocor lewat log/klien; tidak ada alur penyelesaian | Task 2.2 + email transaksional Phase 6 |
| S-15 | **Low** | Harness test menghapus seluruh isi DB memakai `DATABASE_URL` tanpa guard | `packages/auth/src/test-support.ts::resetDatabase` | Salah arah env = kehilangan data | Tolak URL non-dev (mis. wajib mengandung `_test`/`3307`) |

### 9.3 Area yang tidak dapat diuji runtime

IDOR/CSRF/session fixation diuji pada level service, **bukan** lewat HTTP route handler.
Tidak ada test yang mengimpor file `route.ts`, sehingga kontrak HTTP (status code, bentuk
body, header `set-cookie`) tidak tervalidasi otomatis. Ini gap pengujian, bukan bukti
kerentanan.

---

## 10. Testing & Verification

### 10.1 Inventaris test (9 file, 57 test)

| File | Jumlah | Butuh DB | Dieksekusi audit ini |
|---|---|---|---|
| `packages/auth/src/auth.test.ts` (B1–B14) | 14 | Ya | Tidak |
| `packages/auth/src/rbac.test.ts` (C1–C5) | 5 | Ya | Tidak |
| `packages/auth/src/workspaces.test.ts` (D1–D7) | 7 | Ya | Tidak |
| `packages/auth/src/audit.test.ts` (E1–E2) | 2 | Ya | Tidak |
| `packages/auth/src/security.test.ts` (F1–F5) | 5 | Tidak | **Ya — 5/5 PASS** |
| `packages/auth/src/route-policy.test.ts` (H1–H5) | 5 | Tidak | **Ya — 5/5 PASS** |
| `packages/database/src/audit.test.ts` | 8 | Ya | Tidak |
| `packages/database/src/tenant-db.test.ts` (T1–T9) | 9 | Ya | Tidak |
| `apps/web/test/route-policy.test.mjs` | 2 | Tidak | **Ya — 2/2 PASS** |

Tidak ada: integration/E2E HTTP, web UI test, Flutter test, load test, test notifikasi,
test absensi/revisi.

### 10.2 Perintah yang dijalankan (bukti aktual)

| Perintah | Hasil |
|---|---|
| `npm run typecheck` (5 workspace) | **exit 0** — lulus |
| `npm run build --workspace @absensi/auth` | **exit 0** |
| `node --test dist/security.test.js dist/route-policy.test.js` | **10/10 PASS**, exit 0 |
| `npm test --workspace @absensi/web` | **2/2 PASS**, exit 0 |

Log ringkas yang teramati:

```
✔ H1..H5 (route policy)  ✔ F1..F5 (security headers & logger)
tests 10  pass 10  fail 0
✔ setiap route /api punya policy dan sebaliknya
✔ route publik dibatasi health/login/register/csrf
tests 2  pass 2  fail 0
```

### 10.3 Yang **tidak** dijalankan dan alasannya

| Test | Alasan |
|---|---|
| B1–B14, C1–C5, D1–D7, E1–E2, DB audit (8), T1–T9 (45 test) | MariaDB dev berhenti (port 3307 tidak listening); harness memanggil `resetDatabase()` yang menghapus seluruh tabel. Audit mode READ-ONLY melarang mengubah database. |

**Konsekuensi:** klaim di `docs/PHASE-1.md` §6 (test lulus, build produksi, header
security pada respons nyata) adalah **klaim historis yang tidak direproduksi** pada audit
ini. Kode test-nya nyata dan spesifik (bukan test kosong), tetapi status lulusnya
berstatus **NOT VERIFIED** sampai DB dev dijalankan dan suite dieksekusi.

### 10.4 Kualitas test (pembacaan kode)

Kuat: assertion konkret (hash token, TTL, jumlah role, isolasi lintas tenant, grant DB,
redaksi), memakai DB nyata, urutan test dijaga `--test-concurrency=1`.
Lemah: tidak ada test handler HTTP; test D2 menghapus katalog permission global lalu
memulihkannya (berisiko bila test gagal di tengah); tidak ada test negative untuk
`workspace.status`; tidak ada test password policy lewat route.

---

## 11. Phase 1 Verification

| Komponen | Status | Bukti yang diverifikasi | Kekurangan |
|---|---|---|---|
| A. Database & tenant foundation | **PASS** | 12 model/skema + migration + grants + `withTenant` allowlist/override + branded ctx; pembacaan kode penuh | T1–T9 tidak dieksekusi; status migration applied tidak dicek runtime |
| B. Auth & session | **PASS** | `password.ts`, `session.ts`, `csrf.ts`, route auth; CSRF/rate-limit/redaction test lulus | B1–B14 tidak dieksekusi; password di-trim; error 500 untuk password lemah |
| C. RBAC | **PASS** | `requirePermission`, matriks 6×27, provisioning 6 role, role change langsung berlaku | Katalog domain salah (S-2); eskalasi role (S-1) |
| D. Workspace/member/invitation | **PASS** | create atomik, invite token hash, role change transaksi, claim 404 | Token di respons; belum ada accept; belum ada list |
| E. Audit | **PASS** | 5 aksi, redaksi, `ip_hash`, append-only guard + grant | Best-effort (S-5); grant manual |
| F. Security headers & logger | **PASS** | **F1–F5 lulus pada audit ini** | CSP `unsafe-inline` (TD-1-R9) |
| G. Web shell + mobile placeholder | **PASS** | `/sign-in`, form, landing, sign-out, README mobile | Belum di-commit; UI hanya read-only |
| H. Test suite | **PARTIAL** | 12 test lulus; 45 test ada tetapi tidak dapat dieksekusi | Tidak ada test HTTP/E2E; 45 test NOT VERIFIED |

**Kesimpulan Phase 1:** secara implementasi **PASS (7/8)**, dengan H PARTIAL karena
keterbatasan evidence. **Checkpoint terakhir yang PASS: Phase 1 Checkpoint 7F**
(komponen F/H: security headers, logger, route policy). Catatan: label "7F" berasal dari
roadmap, **tidak ditemukan** sebagai penanda di repo — repo hanya menamai komponen A–H.

---

## 12. Phase 2 Task-by-Task Audit

| ID | Task | Status | Artefak | Implementasi aktual | Kekurangan | Risiko | Rekomendasi |
|---|---|---|---|---|---|---|---|
| 2.1 | `GET /api/workspaces` + workspace members | **NOT STARTED** | `apps/web/src/app/api/workspaces/route.ts` (hanya POST), `.../members/route.ts` (hanya POST), `session.ts::loadWorkspacesForUser` | Library daftar workspace ada dan dipakai `/api/auth/me` + landing; **tidak ada handler GET** dan tidak ada query member list | Tidak ada endpoint, pagination, bentuk respons, test | UI member tidak mungkin dibangun; mobile tidak bisa memuat daftar | Implementasikan GET workspace (session) + GET members (`member.read`, claim 404, pagination) |
| 2.2 | Accept-invitation + dev-echo token | **NOT STARTED** | `workspaces.ts::inviteMember` | Undangan dibuat dengan `token_hash` + expiry 7 hari; token mentah dikembalikan sekali | Tidak ada route accept, tidak ada konsumsi token, tidak ada dev-echo, tidak ada penanganan user baru vs existing, tidak ada email | Undangan tidak dapat diselesaikan; alur onboarding karyawan mati | Rancang accept: verifikasi hash+expiry+status, buat/link user, membership+role, tandai ACCEPTED, audit; dev-echo hanya di non-production |
| 2.3 | `GET /api/health/ready` | **NOT STARTED** | `apps/web/src/app/api/health/route.ts` (liveness statis), `packages/database/src/health.ts` | `checkDatabaseHealth()` ada tetapi **tidak dipakai**; tidak ada route readiness; registry tidak punya entri | Tidak ada probe DB; orkestrator tidak bisa menilai kesiapan | Deploy menerima traffic saat DB mati | Route readiness 200/503, tanpa detail internal, tambahkan ke registry + test |
| 2.4 | Rate limit per-user di route workspace | **NOT STARTED** | `rate-limit.ts` | Hanya `enforceLoginRateLimit` (login). Tidak ada pemakaian di route workspace | Tidak ada limiter per-user/per-tenant; tidak ada header `Retry-After` | Spam workspace/invite; DoS argon2 tidak relevan setelah bootstrap, tapi pembengkakan data nyata | Limiter generik per-user+route; fail-closed; store bersama bila multi-instance |
| 2.5 | Dokumentasi semantik `withTenant` | **PARTIAL** | `packages/database/src/tenant-db.ts`, `tenancy.ts`, `docs/PHASE-1.md` | JSDoc menjelaskan override filter, allowlist, create paksa tenant, audit append-only | Tidak ada dokumen arsitektur; tidak menjelaskan `systemDb()` call site, batasan opt-in, dan model global; tidak ada contoh benar/salah | Developer baru mudah memakai `systemDb()` atau mengira isolasi otomatis | Tulis `docs/TENANT-ISOLATION.md` + tautkan dari README/PHASE-1 |
| 2.6 | Web UI workspace, member list, invitation form | **NOT STARTED** | landing + sign-in saja | Landing menampilkan workspace aktif dan role | Tidak ada list, form invite, tampilan status undangan, error/loading terstandar, switcher | Deliverable Phase 2 tidak tercapai | Bangun setelah 2.1/2.2 stabil; minimal list + form + state |
| 2.7 | Pengaturan kantor (nama, alamat, timezone, jam kerja) | **NOT STARTED** | — | Tidak ada model, migration, API, validasi timezone/jam kerja, UI | Seluruh task belum ada | Phase 3 geofence tidak punya sumber lokasi/jam kerja | Model `office_settings`/`office_locations` (hati-hati: 3.1 mencakup `office_locations`) + permission `workspace.manage` |

**Deliverable Phase 2 (admin mengelola workspace/member via UI; karyawan mengaktifkan
akun via invitation): BELUM TERCAPAI.**

Catatan desain penting: `API_ROUTE_POLICIES` memetakan **path**, bukan method. Menambah
`GET .../members` dengan `member.read` sementara `POST` memakai `member.invite` tidak
dapat diekspresikan registry saat ini → perlu perluasan (TD-2-R8).

---

## 13. Phase 3–8 Preliminary Status

| Phase | Jumlah task | Status | Blocker/prasyarat utama |
|---|---|---|---|
| 3 — Absensi inti | 9 | 3.9 **PARTIAL** (infrastruktur audit siap, belum ada event absensi); 3.1–3.8 **NOT STARTED** | Katalog/role absensi (S-2); `office_locations` + jam kerja (2.7); provider object storage belum dipilih; Flutter belum ada; urutan check-in/out & timezone belum diputuskan |
| 4 — Revisi kehadiran | 8 | **NOT STARTED** | Bergantung pada `attendance_logs` (Phase 3); notifikasi in-app belum ada; aturan 7 hari/1×bulan butuh definisi timezone |
| 5 — Dashboard & laporan | 5 | **NOT STARTED** | Bergantung Phase 3 & 4; butuh permission `report.*`/`audit.read` yang saat ini tidak relevan domain |
| 6 — Hardening & notifikasi | 6 | **NOT STARTED** | Push/email provider belum dipilih; TD-1-R8/R10/R14 harus ditutup lebih dulu; 6.4 login activity log hanya punya audit `auth.login`, tanpa tabel/UI |
| 7 — HR lanjutan | 6 | **NOT STARTED** | Shift, libur, lembur, WFH, multi-location belum punya model |
| 8 — Scale & integrasi | 6 | **NOT STARTED** | Payroll/face recognition/QR/2FA/offline — seluruhnya di luar fondasi saat ini |

Tidak ada fitur Phase 3–8 yang boleh dianggap "sudah ada" hanya karena infrastruktur
generik (audit, tenant, session) tersedia.

---

## 14. Technical Debt Register

### 14.1 Catatan ID (penting)

Roadmap menyebut **TD-7F-R1 … TD-7F-R5**. ID tersebut **tidak ada di repo** — tidak di
kode, tidak di `docs/PHASE-1.md`, tidak di Git history. Register yang benar-benar
digunakan repo adalah **TD-1-R1 … TD-1-R14**. Audit ini **tidak mengganti** ID mana pun;
ID roadmap dipertahankan sebagai alias dan dipetakan:

| ID roadmap | Padanan repo | Status aktual |
|---|---|---|
| TD-7F-R1 | TD-1-R11 (accept invitation + token) | Terbuka; accept belum ada |
| TD-7F-R2 | TD-1-R2 (selesai) + readiness baru | Readiness NOT STARTED; katalog ada tetapi domain salah |
| TD-7F-R3 | — (dokumentasi `withTenant`) | PARTIAL (JSDoc saja) |
| TD-7F-R4 | TD-1-R12 (list API/UI) | Terbuka; endpoint tidak ada |
| TD-7F-R5 | TD-1-R8 (limiter) | Terbuka; per-user belum ada |

### 14.2 Debt Phase 1 (existing)

| ID | Item | Status | Severity | Target |
|---|---|---|---|---|
| TD-1-R1 | Auth/session/CSRF/Bearer | Selesai | — | — |
| TD-1-R2 | `requirePermission` + matrix 162 | Selesai | — | — |
| TD-1-R3 | Route workspace/invite/role change | Selesai | — | — |
| TD-1-R4 | Security headers + logger redaction | Selesai | — | — |
| TD-1-R5 | Web sign-in/landing | Selesai (belum commit) | — | Commit Phase 1 |
| TD-1-R6 | Test auth/CSRF/route permission | Selesai (sebagian NOT VERIFIED) | — | Jalankan suite DB |
| TD-1-R7 | Dev DB dijalankan manual | Terbuka | Low | Operasional |
| TD-1-R8 | Rate limiter in-memory | Terbuka | High | Phase 2 (2.4) |
| TD-1-R9 | CSP `unsafe-inline` | Terbuka | Low | Phase 2 |
| TD-1-R10 | XFF dipercaya tanpa allowlist; `TRUST_PROXY` tidak dipakai | Terbuka | High | Phase 2 |
| TD-1-R11 | Token undangan via API, belum ada accept/email | Terbuka | Medium | Phase 2 (2.2) |
| TD-1-R12 | Switcher workspace & modul absensi belum ada | Terbuka | High | Phase 2 (2.6) |
| TD-1-R13 | `active_tenant_id` selalu workspace pertama; tidak ada switch | Terbuka | High | Phase 2 |
| TD-1-R14 | Audit best-effort | Terbuka | Medium | Phase 2 (outbox) |

### 14.3 Debt baru (ditemukan audit ini)

| ID | Item | Severity | Dampak | Dependency | Target |
|---|---|---|---|---|---|
| TD-2-R1 | Katalog permission & role memakai domain affiliate; tidak ada `attendance.*`/`correction.*`/`report.*` dan role `EMPLOYEE`/`HR` | **Critical** | Phase 3/4/5 tidak dapat diotorisasi; over-privilege admin | Keputusan pemilik produk | Phase 2 (sebelum Phase 3) |
| TD-2-R2 | Tidak ada rate limit pada create workspace/invite/role/register | High | Spam & pembengkakan data; bypass abuse | TD-1-R8 | Phase 2 (2.4) |
| TD-2-R3 | `workspace.status` tidak dicek per request; sesi tetap sah pada tenant disuspend | Medium | Akses ke tenant nonaktif | — | Phase 2 |
| TD-2-R4 | `rotateSession` tidak dipanggil saat privilege berubah, padahal dokumen mengklaim demikian | Low | Dokumentasi menyesatkan; token lama tetap berlaku | — | Phase 2 |
| TD-2-R5 | `.env.example` tidak lengkap; `TRUST_PROXY` & `ENABLE_PERMISSION_PROBE` tidak dipakai kode | Low | Setup gagal/kacau; config mati | — | Phase 2 |
| TD-2-R6 | Append-only audit bergantung `grants.sql` manual; tidak ada trigger/migration | Medium | Integritas audit berbeda antar environment | Prosedur deploy | Phase 2 |
| TD-2-R7 | Harness test `resetDatabase()` tanpa guard URL non-dev | Low | Risiko kehilangan data bila env salah | — | Phase 2 |
| TD-2-R8 | `API_ROUTE_POLICIES` per-path, tidak bisa membedakan permission per method (GET `member.read` vs POST `member.invite`) | Medium | Task 2.1 tidak bisa dinyatakan sesuai policy | — | Phase 2 (2.1) |
| TD-2-R9 | `PasswordPolicyError` tidak dipetakan ke HTTP 400 (menghasilkan 500) | Medium | Kontrak API & UX salah | — | Phase 2 (2.1/2.2) |
| TD-3-R1 | Provider object storage untuk foto absensi belum dipilih/dikonfigurasi | High | Task 3.5 tidak bisa dimulai | Keputusan produk | Sebelum Phase 3 |

---

## 15. Known Limitations

1. 45 test berbasis DB tidak dieksekusi; status lulusnya historis (klaim dokumen), bukan
   hasil audit ini.
2. Status migration "applied" tidak diperiksa runtime karena DB dimatikan.
3. Tidak ada verifikasi browser (tidak ada Chrome) dan tidak ada runtime Flutter.
4. Tidak ada CI, sehingga "hijau" hanya berarti perintah lokal.
5. `README.md` masih menyebut proyek "scaffold — belum ada fitur", bertentangan dengan
   implementasi Phase 1; dokumentasi status tersebar dan tidak konsisten.
6. Tidak ada observability (metrics/tracing), hanya logger JSON ke stderr.
7. Tidak ada backup/restore atau prosedur disaster recovery untuk DB dev.

---

## 16. Blockers

| ID | Blocker | Menghalangi | Tindakan |
|---|---|---|---|
| B-1 | Katalog/role RBAC bukan domain absensi | Phase 3, 4, 5 (otorisasi) | Keputusan produk + migrasi katalog (TD-2-R1) |
| B-2 | Tidak ada endpoint list workspace/member | Phase 2 UI, mobile, Phase 3 admin | Task 2.1 |
| B-3 | Tidak ada accept-invitation | Onboarding karyawan (Phase 2 deliverable) | Task 2.2 |
| B-4 | Tidak ada office settings/jam kerja | Geofence & keterlambatan (Phase 3/5) | Task 2.7 + desain timezone |
| B-5 | Flutter belum ada | Phase 3.8, 4.7 | Scaffold pada Phase 3 (bukan sekarang) |
| B-6 | Provider object storage belum ada | Phase 3.5 | Keputusan sebelum Phase 3 |
| B-7 | DB dev berhenti + tidak ada CI | Verifikasi test & rilis | Nyalakan DB dev / bangun CI |
| B-8 | Pekerjaan Phase 1 belum di-commit | Reproducibility & rollback | Commit terpisah sebelum Phase 2 |

---

## 17. Risk Assessment

| Risiko | Probabilitas | Dampak | Skor | Mitigasi |
|---|---|---|---|---|
| Eskalasi privilege role (S-1) dieksploitasi saat multi-admin | Sedang | Kritis | **Tinggi** | Perbaiki sebelum fitur member UI (2.6) dirilis |
| Phase 3 dibangun di atas RBAC domain salah | Tinggi | Tinggi | **Kritis** | Putuskan TD-2-R1 sebelum Phase 3 |
| Test DB tidak pernah dijalankan ulang → regresi senyap | Tinggi | Tinggi | **Tinggi** | Nyalakan DB + CI; jalankan 57 test |
| Rate limit/XFF bypass (S-3/S-4) | Sedang | Tinggi | **Tinggi** | Task 2.4 + TRUST_PROXY |
| Audit tidak lengkap saat insiden | Sedang | Sedang | Sedang | Outbox audit |
| Drift dokumen vs kode (PHASE-1) | Tinggi | Sedang | Sedang | Commit dokumen + satu sumber status |
| Kehilangan data dev karena harness test | Rendah | Tinggi | Sedang | Guard URL test (TD-2-R7) |
| Scope creep melompat ke Phase 3 | Sedang | Tinggi | **Tinggi** | Patuhi Phase Consistency Lock |

---

## 18. Dependency Analysis

```
Phase 2 (2.1 read API) ──► 2.6 Web UI
        │
        ├──► 2.2 accept invitation ──► onboarding karyawan ──► Phase 3 absensi
        │
        ├──► 2.4 rate limit per-user ──► Phase 6.5
        │
        └──► 2.7 office settings ──► Phase 3.1 geofence & jam kerja
Phase 3 ──► Phase 4 ──► Phase 5
Phase 6 (hardening) bergantung TD-1-R8/R10/R14 + provider notifikasi
Phase 7/8 bergantung Phase 3–5
```

Dependency eksternal yang belum ada: object storage, email transaksional, push
notification, Flutter/Dart toolchain, CI runner. Tidak ada satu pun yang boleh
diintegrasikan tanpa keputusan pemilik proyek (dan tanpa audit ini mengubah dependency).

---

## 19. Recommended Next Checkpoint

**Checkpoint berikutnya: Phase 2 — backend read & readiness (task 2.1 + 2.3 + 2.5).**

Alasan:

- Tidak memerlukan migration/skema baru → risiko rendah, dapat di-rollback.
- Membuka jalan untuk 2.6 (UI) dan mobile, serta memberi probe kesiapan untuk deploy.
- Memaksa penyelesaian TD-2-R8 (policy per-method) sebelum menambah route.
- Sesuai urutan roadmap; tidak memindahkan fitur antar-Phase.

Urutan setelahnya: **2.4 → 2.2 → 2.7 → 2.6**, dengan TD-2-R1 diputuskan sebelum
Phase 3 dimulai.

**Bukan** checkpoint yang tepat sekarang: Phase 3 (absensi), karena bergantung pada
office settings, RBAC domain benar, storage, dan Flutter.

---

## 20. Final Recommendation

1. **Jangan mulai coding Phase 3.** Fondasi Phase 2 belum ada.
2. **Commit pekerjaan Phase 1 yang menggantung** (web shell + dokumen + test route policy)
   sebagai commit terpisah, lalu jalankan ulang seluruh 57 test dengan MariaDB dev aktif
   dan catat hasil nyata.
3. **Selesaikan 2.1/2.3/2.5** sesuai `docs/NEXT-EXECUTION-PLAN.md`.
4. **Putuskan TD-2-R1** (katalog & role absensi) sebelum Phase 3; ini keputusan produk,
   bukan sekadar refactor.
5. **Tutup S-1** (eskalasi role) sebelum UI member dirilis, dan **S-3/S-4** pada task 2.4.
6. **Bangun CI minimal** (typecheck + test DB terisolasi) agar status PASS dapat
   direproduksi, bukan diklaim.

**STOP. Tidak ada implementasi yang dilakukan pada audit ini. Menunggu persetujuan
pemilik proyek sebelum eksekusi.**

---

## Lampiran A — Fakta terverifikasi vs asumsi

**Terverifikasi langsung (dibaca/dijalankan):**
- Struktur repo, 7 commit, branch, status working tree, tidak ada remote.
- 9 route API dan method-nya; tidak ada GET workspace/members/readiness.
- 12 model Prisma + 1 migration + seed 27 permission + grants append-only.
- Implementasi `withTenant`, `systemDb`, audit, session, CSRF, rate limit, logger.
- `rotateSession` tidak dipanggil kode produk; `checkDatabaseHealth` tidak dipakai.
- Tidak ada kode Flutter/Dart; tidak ada dependency storage/upload.
- `npm run typecheck` exit 0; 12 test DB-free PASS; build auth exit 0.

**Asumsi/klaim yang belum diverifikasi pada audit ini:**
- 45 test DB pernah lulus (hanya klaim `docs/PHASE-1.md`, tidak direproduksi).
- Migration sudah `deploy` ke `absensi_dev` (file `.ibd` ada, tetapi status
  `_prisma_migrations` tidak dibaca).
- Build produksi Next.js dan pemeriksaan header pada respons nyata (klaim dokumen).
- Perilaku runtime UI di browser (tidak ada browser tersedia).

## Lampiran B — Perintah audit yang dijalankan

```bash
git rev-parse --abbrev-ref HEAD; git log -1; git status --porcelain; git log --oneline -30
git diff -- docs/PHASE-1.md; git diff --cached --stat; git stash list
npm run typecheck
npm run build --workspace @absensi/auth
node --test --test-force-exit dist/security.test.js dist/route-policy.test.js
npm test --workspace @absensi/web
```

Tidak ada perintah yang menulis database, migration, environment, atau Git.

---

## Addendum — Status setelah commit (2026-11-19)

Audit historis di atas dipertahankan sebagai catatan titik waktu. Sejak audit itu:

- Phase 1 web shell di-commit sebagai `61e1398`.
- Unit 2A, S-1, verifikasi, mixed concurrency, dan S-1.1 di-commit sebagai `ab9bc0c`.
- Post-commit typecheck, auth 73/73, database 21/21, web 2/2, permissions 9/9, build, dan Prisma validate lulus pada DB verifikasi terisolasi.
- Unit 2B **tidak diimplementasikan** karena keputusan identity/onboarding, kontrak accept-invitation, kuota rate limit, dan proxy trust belum disetujui.
- Task 2.6 dan 2.7 belum dimulai; Phase 2 berstatus **NOT COMPLETE**.
- Tidak ada migration, perubahan `.env`, push, atau perubahan database development/production.

Lihat `docs/PHASE-2-COMPLETION-REPORT.md`, `docs/PHASE-2-UNIT-2B-REQUIREMENTS-AND-DECISION-REPORT.md`, dan `docs/PHASE-3-READINESS-REPORT.md` untuk status terkini.
