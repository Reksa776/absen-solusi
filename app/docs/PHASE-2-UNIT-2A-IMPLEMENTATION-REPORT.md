# Phase 2 — Unit 2A Implementation Report

**Tanggal:** 2026-11-19
**Unit:** Phase 2 Execution Unit 2A — Task 2.1, 2.3, 2.5
**Git root:** `app/`
**HEAD:** `47e77c0527a4510c23d31017e78feaacdd978fd2` (tidak berubah)
**Status akhir:** **PASS WITH LIMITATIONS**

> Unit ini hanya mencakup 2.1, 2.3, dan 2.5. Task 2.2, 2.4, 2.6, 2.7 dan seluruh
> Phase 3–8 **tidak** dikerjakan. Roadmap tidak diubah.

---

## 1. Executive Summary

Tiga task disetujui selesai di level implementasi:

| Task | Hasil | Bukti utama |
|---|---|---|
| 2.1 Workspace & Member Read API | **PASS WITH LIMITATIONS** | `GET /api/workspaces`, `GET /api/workspaces/:id/members`, service `listWorkspaceMembers()`, pagination, test L1–L5 (belum dieksekusi) |
| 2.3 Readiness Check | **PASS WITH LIMITATIONS** | `GET /api/health/ready`, `checkReadiness()`, test K1–K2 lulus |
| 2.5 Dokumentasi `withTenant` | **PASS** | `docs/TENANT-ISOLATION.md`, tertaut dari README dan `docs/PHASE-1.md` |

**Verifikasi yang benar-benar dijalankan:** build database/auth/web, typecheck 5
workspace, 11 test auth (F1–F5, H1–H6), 2 test readiness (K1–K2), dan 2 test web.
Seluruhnya **lulus tanpa kegagalan**.

**Batasan utama:** 5 test DB baru (L1–L5) **tidak dieksekusi** karena approval
melarang perubahan/peresetan database development dan test harness yang ada
memanggil `resetDatabase()`. Test tersebut berstatus **NOT VERIFIED**, bukan
PASS. Test handler HTTP untuk route baru belum ditambahkan (lihat §9).

**Tidak ada** perubahan schema, migration, `.env`, dependency, atau Git history.
Critical **S-1 tetap terbuka** dan tidak diperbaiki di unit ini.

---

## 2. Task 2.1 Implementation

### 2.1.1 `GET /api/workspaces`

File: `apps/web/src/app/api/workspaces/route.ts`

- Auth: `requireApiSession(request)` — cookie atau Bearer; 401
  `UNAUTHENTICATED` bila sesi tidak valid.
- Data: `loadWorkspacesForUser(session.userId)` yang sudah memfilter membership
  `ACTIVE` **dan** `workspace.status = ACTIVE`.
- Respons `200`:

```json
{
  "workspaces": [
    { "id": "…", "name": "…", "slug": "…", "memberId": "…", "roleKeys": ["VIEWER"] }
  ]
}
```

- Tidak memakai `requirePermission`, karena ini daftar workspace milik user
  sendiri (sama seperti `/api/auth/me`). Tidak ada `:id` dari klien.

### 2.1.2 `GET /api/workspaces/:id/members`

File: `apps/web/src/app/api/workspaces/[id]/members/route.ts`
Service: `packages/auth/src/workspaces.ts` → `listWorkspaceMembers()`

- Auth + authorization: `requirePermission(request, "member.read")` — dicek
  **sebelum** query. Tanpa sesi → 401; tanpa permission → 403 `FORBIDDEN`.
- Tenant: `assertWorkspaceClaim(ctx, id)` → 404 `WORKSPACE_NOT_FOUND` identik
  untuk workspace asing dan tidak ada. `:id` hanya klaim; otoritas tetap
  `ctx.tenantId`.
- Query: `withTenant(ctx, …)` untuk `count` dan `findMany`; tidak ada
  `systemDb()` untuk data member.
- Pagination: `limit` default **50**, min 1, max **100**; `offset` default 0,
  min 0. Nilai bukan integer, negatif, atau melebihi batas → `400
  INVALID_PAGINATION`.
- Urutan stabil: `createdAt asc, id asc`.
- Respons `200`:

```json
{
  "members": [
    {
      "id": "…",
      "status": "ACTIVE",
      "joinedAt": "2026-11-18T00:00:00.000Z",
      "user": { "id": "…", "name": "…", "email": "…" },
      "roleKeys": ["VIEWER"]
    }
  ],
  "pagination": { "limit": 50, "offset": 0, "total": 1 }
}
```

- Field memakai allowlist eksplisit; tidak ada `passwordHash`, `tokenHash`,
  `ipHash`, atau objek Prisma mentah.
- `joinedAt` boleh `null` (schema `DateTime?`).

### 2.1.3 Policy registry per-method (TD-2-R8)

File: `packages/auth/src/route-policy.ts`

`ApiRoutePolicy` mendapat varian `methods`, dan registry kini membedakan:

| Route | Method | Policy |
|---|---|---|
| `/api/workspaces` | GET | `authenticated` |
| `/api/workspaces` | POST | `authenticated` |
| `/api/workspaces/:id/members` | GET | `permission: member.read` |
| `/api/workspaces/:id/members` | POST | `permission: member.invite` |
| `/api/workspaces/:id/members/:memberId/role` | PATCH | `permission: role.manage` |

Test H1/H6 sekarang memindai **method yang benar-benar diekspor** file route,
bukan hanya keberadaan path. Ini menutup TD-2-R8 dan mencegah route baru tanpa
policy.

---

## 3. Task 2.3 Implementation

File route: `apps/web/src/app/api/health/ready/route.ts`
Logika: `packages/database/src/health.ts` → `checkReadiness()`

- Publik, tanpa auth, tanpa CSRF (GET).
- `checkReadiness()` menjalankan:
  1. `checkDatabaseHealth()` — satu `SELECT 1`, error ditelan.
  2. `assertPermissionCatalog()` — validasi katalog 27 permission, tanpa
     duplikat, setiap role punya permission yang valid.
- Respons `200`:

```json
{ "status": "ready", "checks": { "database": "up", "permissions": "ok" } }
```

- Respons `503`:

```json
{ "status": "not_ready", "checks": { "database": "down", "permissions": "ok" } }
```

- Tidak ada pesan error DB, host, kredensial, stack trace, atau versi.
- Entry registry: `"/api/health/ready": { kind: "public", reason: "readiness probe (database + katalog permission)" }`.
- `middleware.ts` sudah memberi `Cache-Control: no-store` untuk `/api/*`; tidak
  diubah.

Catatan kontrak: readiness di sini menambahkan `checks.permissions` karena
acceptance criteria approval meminta validasi katalog permission. Ini
memperluas kontrak di `NEXT-EXECUTION-PLAN.md` §3.4 (yang hanya menyebut
database), bukan menyimpang darinya.

---

## 4. Task 2.5 Documentation

File baru: `docs/TENANT-ISOLATION.md`.

Isi (10 bagian):

1. Ringkasan jaminan dan non-jaminan (isolasi opt-in, tanpa jaminan kompilasi).
2. Sumber `TenantContext`: sesi → `active_tenant_id` → membership ACTIVE →
   `resolveMemberPermissions` → `createTenantContext`.
3. Perilaku `withTenant` per operasi, allowlist model, `Workspace` istimewa,
   `AuditLog` append-only.
4. Tabel seluruh call site `systemDb()` beserta alasan dan aturan penambahan.
5. Model global (`User`, `Session`, `Permission`) dan alasannya.
6. Contoh benar (ditautkan ke `listWorkspaceMembers`, `inviteMember`).
7. Contoh salah (systemDb unscoped, filter di aplikasi, context palsu, spread
   objek Prisma).
8. Kesalahan isolasi yang paling mungkin terjadi.
9. Batasan yang terbukti dari kode (lihat §10 laporan ini).
10. Checklist review service baru + status verifikasi.

Tautan ditambahkan di:

- `README.md` → bagian **Dokumentasi**.
- `docs/PHASE-1.md` §3 dan §4.

Contoh penggunaan dapat ditelusuri ke source code nyata; tidak ada contoh
fiktif. Klaim yang belum diuji diberi label eksplisit.

---

## 5. Files Changed

### Baru

| File | Isi |
|---|---|
| `apps/web/src/app/api/health/ready/route.ts` | Route readiness 200/503 |
| `packages/database/src/health.test.ts` | Test K1–K2 (stub client) |
| `docs/TENANT-ISOLATION.md` | Dokumentasi Task 2.5 |
| `docs/PHASE-2-UNIT-2A-IMPLEMENTATION-REPORT.md` | Laporan ini |
| `docs/PHASE-2-NEXT-CHECKPOINT.md` | Rekomendasi checkpoint berikutnya |

### Diubah

| File | Perubahan |
|---|---|
| `apps/web/src/app/api/workspaces/route.ts` | Tambah `GET` |
| `apps/web/src/app/api/workspaces/[id]/members/route.ts` | Tambah `GET` + parsing pagination |
| `apps/web/test/route-policy.test.mjs` | Validasi per-method + route publik `ready` |
| `packages/auth/src/workspaces.ts` | `listWorkspaceMembers()`, konstanta & validasi pagination |
| `packages/auth/src/index.ts` | Ekspor fungsi/tipe baru |
| `packages/auth/src/route-policy.ts` | Varian `methods`, entry `ready` |
| `packages/auth/src/route-policy.test.ts` | H1/H3/H4/H6 disesuaikan; H6 baru |
| `packages/auth/src/workspaces.test.ts` | Test DB L1–L5 (belum dieksekusi) |
| `packages/database/src/health.ts` | `checkReadiness()` + tipe |
| `packages/database/src/index.ts` | Ekspor readiness |
| `README.md` | Bagian Dokumentasi |
| `docs/PHASE-1.md` | Tautan ke TENANT-ISOLATION |

### Tidak disentuh (dikonfirmasi)

`schema.prisma`, `migrations/`, `grants.sql`, `.env*`, `package.json`/
`package-lock.json`, `packages/permissions/src/index.ts`, konfigurasi Prisma.

---

## 6. API Contract

### `GET /api/workspaces`

| Aspek | Nilai |
|---|---|
| Auth | Sesi valid (cookie/Bearer) |
| Sukses | `200 { workspaces: WorkspaceSummary[] }` |
| Gagal | `401 UNAUTHENTICATED` |
| Isolasi | Hanya membership user pada workspace ACTIVE |

### `GET /api/workspaces/:id/members`

| Aspek | Nilai |
|---|---|
| Auth | Sesi valid + permission `member.read` |
| Query | `limit` (1–100, default 50), `offset` (≥0, default 0) |
| Sukses | `200 { members, pagination: { limit, offset, total } }` |
| Tanpa sesi | `401 UNAUTHENTICATED` |
| Tanpa permission | `403 FORBIDDEN` |
| Workspace asing/tidak ada | `404 WORKSPACE_NOT_FOUND` (pesan identik) |
| Pagination invalid | `400 INVALID_PAGINATION` |
| Field terlarang | Tidak ada hash/token/secret |

### `GET /api/health/ready`

| Aspek | Nilai |
|---|---|
| Auth | Publik (probe) |
| Sukses | `200 { status: "ready", checks: { database: "up", permissions: "ok" } }` |
| Gagal | `503` dengan `status: "not_ready"` dan status dependency |
| Kebocoran | Tidak ada pesan error/host/kredensial |

### Format error

Semua route memakai `handleRouteError()` → `{ error: { code, message } }`,
konsisten dengan route Phase 1.

---

## 7. Security Verification

| Kontrol | Implementasi | Status |
|---|---|---|
| Authentication | `requireApiSession` / `requirePermission` | Ada di kode + typecheck |
| Authorization | `member.read` dicek sebelum query | Ada di kode |
| Tenant dari sesi | `ctx` dari `active_tenant_id`, bukan `:id` | Ada di kode |
| Klaim URL | `assertWorkspaceClaim` → 404 identik | Ada di kode |
| Query ter-scope | `withTenant` untuk count + findMany | Ada di kode |
| Allowlist respons | Mapping field eksplisit | Test L5 (belum jalan) |
| Pagination | Batas 100, validasi integer | Test L3 (belum jalan) |
| Readiness tanpa secret | Hanya `up/down`, `ok/invalid` | Test K2 **PASS** |
| Route policy | Setiap method diekspor punya policy | Test H1/H6 **PASS** |
| Rate limit workspace | Tidak ada | **Terbuka (2.4)** |
| Eskalasi role (S-1) | Tidak diperbaiki | **Terbuka (Critical)** |

Tidak ada test keamanan lama yang dilemahkan. H4 diubah karena kontrak policy
memang berubah (per-method); assertion baru lebih ketat, bukan lebih longgar.

---

## 8. Tenant Isolation Verification

Status: **terverifikasi di level kode + test tertulis; belum di level runtime.**

- `listWorkspaceMembers()` memanggil `assertWorkspaceClaim` **sebelum**
  `withTenant`.
- `count()` dan `findMany()` tidak menyertakan `tenantId` dari input; extension
  menimpanya dengan `ctx.tenantId`.
- Workspace asing dan tidak ada melempar `HttpError` yang sama (404, kode dan
  pesan sama) tanpa query data.
- Test L1 (tenant lain tidak terlihat), L4 (404 identik), dan L5 (tidak ada
  hash) sudah ditulis, tetapi **belum dieksekusi**.
- Dokumentasi mencatat tiga celah nyata pada `withTenant`: `update.data.tenantId`,
  `upsert.create.tenantId`, dan nested write tidak dipaksa/dibersihkan.

---

## 9. Automated Test Results

### Dijalankan (evidence nyata)

| Perintah | Hasil |
|---|---|
| `npm run build --workspace @absensi/database` | **exit 0** |
| `npm run build --workspace @absensi/auth` | **exit 0** |
| `npm run typecheck` (5 workspace) | **exit 0** |
| `node --test dist/security.test.js dist/route-policy.test.js` (auth) | **11/11 PASS** |
| `node --test dist/health.test.js` (database) | **2/2 PASS** |
| `npm test --workspace @absensi/web` | **2/2 PASS** |
| `npm run build --workspace @absensi/web` (Next.js) | **exit 0**, route baru terdaftar |

Total test aman yang dieksekusi: **15 pass, 0 fail**.

### Test baru

| ID | Cakupan | Status |
|---|---|---|
| H1 | Setiap method route punya policy | PASS |
| H6 | Policy tidak mendeklarasikan method yang tidak ada | PASS |
| H3 | Daftar route publik termasuk `ready` | PASS |
| K1 | Readiness ready (DB stub sukses) | PASS |
| K2 | Readiness not_ready + tanpa kebocoran | PASS |
| L1 | List member hanya tenant sendiri | **NOT VERIFIED** |
| L2 | Pagination default/limit/offset/stabilitas | **NOT VERIFIED** |
| L3 | Input pagination invalid → 400 | **NOT VERIFIED** |
| L4 | Foreign vs missing → 404 identik | **NOT VERIFIED** |
| L5 | Respons tanpa hash/token, field terbatas | **NOT VERIFIED** |

### Tidak dijalankan

- Seluruh suite `npm test` (auth + database) karena menjalankan test DB dan
  memanggil `resetDatabase()` pada database development.
- Test handler HTTP untuk route baru. Handler Next.js mengimpor alias `@/lib/api`
  dan Prisma; harness `node --test` paket auth tidak bisa me-resolve-nya tanpa
  menambah konfigurasi/test runner baru (dependency tidak diizinkan). Ini
  dicatat sebagai TD-2A-R2.

### Jumlah suite

| Kategori | Jumlah |
|---|---|
| Total test di repo setelah unit ini | **65** |
| DB-free, dieksekusi PASS | **15** |
| Berbasis DB, NOT VERIFIED | **50** (45 lama + 5 baru) |

---

## 10. Known Limitations

1. **Test DB belum dijalankan.** 50 test membutuhkan MariaDB dev; approval
   melarang perubahan database dan test harness mereset seluruh tabel.
2. **Belum ada test handler HTTP** untuk kedua endpoint baru dan readiness.
   Kontrak route diverifikasi lewat typecheck, build, dan service test, bukan
   pemanggilan handler.
3. **Readiness hanya diuji dengan client stub.** Kondisi DB mati nyata belum
   pernah dijalankan.
4. **Validasi katalog permission bersifat statis** (`assertPermissionCatalog`),
   bukan verifikasi bahwa katalog benar-benar ter-seed di database.
5. **Rate limit workspace tetap tidak ada** (task 2.4).
6. **S-1 tetap terbuka** (lihat §12).
7. **RBAC masih domain affiliate** (TD-2-R1); `member.read` ada di semua role,
   tetapi role absensi belum didefinisikan.
8. **Celah isolasi `withTenant`** untuk update/upsert/nested write masih ada
   (TD-2A-R3); didokumentasikan, belum diperbaiki.

---

## 11. Technical Debt Register

| ID | Item | Dampak | Alokasi |
|---|---|---|---|
| TD-2A-R1 | 50 test DB (termasuk L1–L5) NOT VERIFIED | isolasi/pagination belum terbukti runtime | sebelum checkpoint Phase 2 |
| TD-2A-R2 | Tidak ada test handler HTTP | kontrak status/body route tidak terkunci | unit test berikutnya |
| TD-2A-R3 | `withTenant` tidak membersihkan `update.data.tenantId`; `upsert.create` tidak dipaksa; nested write tidak diintervensi | potensi perpindahan/penulisan lintas tenant oleh kode baru | sebelum Phase 3 |
| TD-2A-R4 | Readiness tidak memeriksa seed katalog di DB | DB kosong bisa dilaporkan ready | sebelum deploy |
| TD-2-R8 | Policy per-path | **SELESAI** di unit ini (per-method) | — |

Debt lama yang tetap terbuka dan relevan: TD-1-R8 (rate limiter in-memory),
TD-1-R10 (`X-Forwarded-For`), TD-1-R11 (token undangan via API), TD-1-R12/R13
(switcher workspace), TD-2-R1 (katalog absensi), TD-2-R9 (test harness reset
tanpa guard URL).

---

## 12. Critical S-1 Status

**Status: OPEN — tidak diperbaiki di unit ini (sesuai approval).**

Temuan: aktor dengan `role.manage` dapat menetapkan `WORKSPACE_OWNER` kepada
siapa pun dan menurunkan owner yang ada. `changeMemberRole()` hanya memblokir
perubahan role sendiri; tidak ada hierarki role, proteksi last-owner, atau
larangan memberikan role di atas level aktor.

Dampak: eskalasi privilege di dalam workspace. Belum ada UI member, sehingga
permukaan serangan masih API; tetap harus ditutup sebelum Phase 2.6 dirilis.

Rekomendasi penanganan terpisah (belum dieksekusi):

1. Definisikan peringkat role (owner > admin > manager > …) di katalog.
2. Tolak pemberian role di atas level aktor.
3. Tolak penurunan/penghapusan owner terakhir (hitung owner dalam transaksi).
4. Rotasi sesi target setelah perubahan role (gunakan `rotateSession`).
5. Audit `role.change` tetap dipertahankan; tambahkan alasan penolakan.
6. Test DB: self-change, assign owner oleh admin, demote last owner.

---

## 13. Git Status Before & After

**HEAD:** `47e77c0527a4510c23d31017e78feaacdd978fd2` — sama sebelum dan sesudah.

### Sebelum unit

```
M  apps/web/next-env.d.ts
M  apps/web/src/app/page.tsx
A  apps/web/src/app/sign-in/page.tsx
A  apps/web/src/app/sign-in/sign-in-form.tsx
A  apps/web/src/app/sign-out-button.tsx
 M docs/PHASE-1.md
?? docs/NEXT-EXECUTION-PLAN.md
?? docs/PROJECT-CURRENT-STATE-AUDIT.md
?? packages/auth/src/route-policy.test.ts
```

### Sesudah unit

```
 M README.md
M  apps/web/next-env.d.ts
 M apps/web/src/app/api/workspaces/[id]/members/route.ts
 M apps/web/src/app/api/workspaces/route.ts
M  apps/web/src/app/page.tsx
A  apps/web/src/app/sign-in/page.tsx
A  apps/web/src/app/sign-in/sign-in-form.tsx
A  apps/web/src/app/sign-out-button.tsx
 M apps/web/test/route-policy.test.mjs
 M docs/PHASE-1.md
 M packages/auth/src/index.ts
 M packages/auth/src/route-policy.ts
 M packages/auth/src/workspaces.test.ts
 M packages/auth/src/workspaces.ts
 M packages/database/src/health.ts
 M packages/database/src/index.ts
?? apps/web/src/app/api/health/ready/
?? docs/NEXT-EXECUTION-PLAN.md
?? docs/PHASE-2-NEXT-CHECKPOINT.md
?? docs/PHASE-2-UNIT-2A-IMPLEMENTATION-REPORT.md
?? docs/PROJECT-CURRENT-STATE-AUDIT.md
?? docs/TENANT-ISOLATION.md
?? packages/auth/src/route-policy.test.ts
?? packages/database/src/health.test.ts
```

Perubahan lokal Phase 1 **tidak dihapus atau ditimpa**. Tidak ada `git reset`,
`checkout`, `stash`, `clean`, `commit`, atau `push`.

---

## 14. Acceptance Criteria Results

### Task 2.1

| Kriteria | Status | Catatan |
|---|---|---|
| Kedua endpoint dapat dipakai aktor berwenang | **PASS WITH LIMITATIONS** | Route + service + build lulus; belum diuji runtime |
| Data tidak dapat diakses lintas tenant | **PASS WITH LIMITATIONS** | Kode memakai `withTenant` + claim; L1/L4 NOT VERIFIED |
| Unauthorized/forbidden ditangani benar | **PASS WITH LIMITATIONS** | 401/403 dari helper yang sudah teruji; handler belum diuji |
| Automated tests PASS | **PARTIAL** | Test policy PASS; test DB NOT VERIFIED |

### Task 2.3

| Kriteria | Status | Catatan |
|---|---|---|
| Mendeteksi kondisi dependency | **PASS WITH LIMITATIONS** | Stub up/down lulus; DB nyata belum diuji |
| Katalog permission tervalidasi | **PASS** | `assertPermissionCatalog()` dipanggil, K1/K2 lulus |
| Tidak membocorkan informasi sensitif | **PASS** | K2 memeriksa string error/host/user |
| Automated tests PASS | **PASS** | K1–K2 2/2 |

### Task 2.5

| Kriteria | Status | Catatan |
|---|---|---|
| Dokumentasi sesuai implementasi aktual | **PASS** | Setiap klaim menunjuk file/fungsi |
| Tidak ada asumsi tak terverifikasi | **PASS** | Batasan diberi label dan status uji |
| Contoh dapat ditelusuri ke source | **PASS** | `listWorkspaceMembers`, `inviteMember`, `requirePermission` |

### Batasan approval

| Larangan | Dipatuhi |
|---|---|
| Schema/migration/database | Ya — tidak disentuh/dijalankan |
| Dependency | Ya — tidak ada perubahan |
| S-1 & RBAC affiliate | Ya — tidak diubah |
| Task Phase 2 lain / Phase 3 | Ya — tidak dikerjakan |
| Git reset/commit/push | Ya — tidak dilakukan |

---

## 15. Final Verdict

**PASS WITH LIMITATIONS.**

Implementasi 2.1, 2.3, dan 2.5 selesai dan konsisten dengan arsitektur Phase 1:
route policy per-method, tenant dari sesi, query lewat `withTenant`, respons
allowlist, readiness tanpa kebocoran, serta dokumentasi yang dapat ditelusuri.

Alasan status bukan PASS penuh:

1. 50 test berbasis DB (termasuk 5 test isolasi baru) **belum dijalankan**.
2. Belum ada test handler HTTP untuk route baru.
3. Rate limit workspace dan S-1 masih terbuka.

Unit ini **tidak** boleh dianggap sebagai checkpoint Phase 2 PASS. Checkpoint
baru layak diberikan setelah test DB dijalankan dan S-1 ditutup.
