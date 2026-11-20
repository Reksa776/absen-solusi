# NEXT EXECUTION PLAN — Phase 2 (Backend Read & Readiness)

**Status dokumen:** DRAFT — **BELUM DIEKSEKUSI**
**Tanggal:** 2026-11-19
**Phase aktif:** Phase 2 — Workspace & Member Management Lengkap
**Checkpoint terakhir yang PASS:** Phase 1 Checkpoint 7F (komponen F/H), dengan catatan
45 test berbasis DB berstatus NOT VERIFIED (lihat `docs/PROJECT-CURRENT-STATE-AUDIT.md` §10)
**Task berikutnya:** 2.1 (GET workspace + member list) → 2.3 (readiness) → 2.5 (dokumentasi)

> Roadmap **tidak diubah** oleh dokumen ini. Tidak ada Phase baru, tidak ada fitur yang
> dipindahkan antar-Phase. Phase 3 tetap bergantung pada selesainya Phase 2.

---

## 1. Ringkasan unit eksekusi

Satu unit kerja, satu commit, tanpa migration:

| Task | Isi | Kenapa sekarang |
|---|---|---|
| 2.1 | `GET /api/workspaces`, `GET /api/workspaces/:id/members` | Membuka UI member (2.6), mobile, dan admin absensi |
| 2.3 | `GET /api/health/ready` (probe DB) | Diperlukan sebelum deploy/CI; `checkDatabaseHealth()` sudah ada tetapi mati |
| 2.5 | `docs/TENANT-ISOLATION.md` | Semantik `withTenant`/`systemDb` harus terdokumentasi sebelum Phase 3 menambah tabel |

**Di luar scope unit ini (jangan dikerjakan sekaligus):** 2.2 accept-invitation,
2.4 rate limit per-user, 2.6 UI, 2.7 office settings, seluruh Phase 3+.

---

## 2. Prasyarat (harus selesai sebelum mulai)

1. **Commit pekerjaan Phase 1 yang menggantung.** Working tree saat ini berisi
   perubahan staged (`apps/web/src/app/page.tsx`, `sign-in/*`, `sign-out-button.tsx`,
   `next-env.d.ts`), unstaged `docs/PHASE-1.md`, dan untracked
   `packages/auth/src/route-policy.test.ts`. Commit terpisah agar hasil Phase 2 dapat
   di-rollback tanpa kehilangan Phase 1.
2. **MariaDB dev aktif** di `app/.devdb/` port 3307 (lihat `docs/PHASE-1.md` §8), lalu
   jalankan seluruh suite yang ada dan catat hasil nyata:
   `npm test` dan `npm test --workspace @absensi/web`. Jangan lanjut bila ada test merah.
3. **Konfirmasi tidak ada migration tertunda**: `npm run prisma:validate`.
   Unit ini **tidak boleh** membuat migration.
4. **Keputusan produk yang dibutuhkan (bukan blocker unit ini, tetapi harus dicatat):**
   katalog permission/role absensi (TD-2-R1). Jangan mengubah katalog pada unit ini —
   perubahan itu menyentuh Phase 3 dan harus disetujui pemilik proyek.
5. Baca `docs/PROJECT-CURRENT-STATE-AUDIT.md` §9 (S-1) — perbaikan eskalasi role adalah
   pekerjaan terpisah, **tidak** termasuk unit ini, tetapi harus selesai sebelum UI
   member (2.6) dirilis.

---

## 3. Scope implementasi

### 3.1 Perluas policy registry menjadi per-method (TD-2-R8)

Saat ini `API_ROUTE_POLICIES` memetakan **path** ke satu policy, sehingga
`GET .../members` (`member.read`) dan `POST .../members` (`member.invite`) tidak dapat
dideklarasikan bersamaan.

Bentuk yang diusulkan (kompatibel ke belakang untuk path yang hanya punya satu method):

```ts
export type ApiRoutePolicy =
  | { kind: "public"; reason: string }
  | { kind: "authenticated"; reason: string }
  | { kind: "permission"; permission: PermissionKey }
  | { kind: "methods"; methods: Record<string, ApiRoutePolicy> };
```

- Semua path yang ada tetap valid; tambahkan varian `methods` hanya untuk
  `/api/workspaces/:id/members`.
- Perbarui **H1–H4** di `packages/auth/src/route-policy.test.ts` agar memvalidasi method
  yang benar-benar diekspor file route (baca `export async function (GET|POST|...)` dari
  source) dan memastikan setiap method punya policy.
- Perbarui `apps/web/test/route-policy.test.mjs` (daftar route publik berubah karena
  `/api/health/ready`).

### 3.2 `GET /api/workspaces`

- Auth: session valid (cookie atau Bearer). **Tidak** memakai `requirePermission`,
  karena ini daftar workspace milik user sendiri (sama seperti `/api/auth/me`).
- Data: `loadWorkspacesForUser(session.userId)` — sudah memfilter membership `ACTIVE`
  dan `workspace.status = ACTIVE`.
- Respons `200`:

```json
{ "workspaces": [ { "id": "...", "name": "...", "slug": "...", "memberId": "...", "roleKeys": ["VIEWER"] } ] }
```

- `401 UNAUTHENTICATED` bila sesi tidak valid. Tidak ada data tenant lain.

### 3.3 `GET /api/workspaces/:id/members`

- Auth + permission: `requirePermission(request, "member.read")`.
- Claim: `assertWorkspaceClaim(ctx, id)` → `404 WORKSPACE_NOT_FOUND` identik untuk
  workspace asing dan tidak ada.
- Query lewat `withTenant(ctx, db => ...)`; `include: { user, roles: { include: { role } } }`.
- Pagination wajib: `limit` (default 50, min 1, max 100) dan `offset` (default 0, min 0).
  Nilai non-integer/negatif/melebihi batas → `400 INVALID_PAGINATION`.
- Urutan stabil: `createdAt asc, id asc`.
- Respons `200`:

```json
{
  "members": [
    {
      "id": "...",
      "status": "ACTIVE",
      "joinedAt": "2026-11-18T00:00:00.000Z",
      "user": { "id": "...", "name": "...", "email": "..." },
      "roleKeys": ["VIEWER"]
    }
  ],
  "pagination": { "limit": 50, "offset": 0, "total": 1 }
}
```

- **Dilarang** mengembalikan `passwordHash`, `tokenHash`, `ipHash`, atau metadata sesi.
- `total` dihitung dengan filter tenant yang sama (bukan `count()` global).

### 3.4 `GET /api/health/ready`

- Publik (probe), tanpa auth, tanpa CSRF (GET).
- Pakai `checkDatabaseHealth()` dari `@absensi/database`.
- `200` → `{ "status": "ready", "checks": { "database": "up" } }`
- `503` → `{ "status": "not_ready", "checks": { "database": "down" } }`
- Tidak boleh mengembalikan pesan error DB, host, kredensial, atau stack trace.
- Tambahkan entri registry `"/api/health/ready": { kind: "public", reason: "readiness probe (DB)" }`;
  perbarui test yang membatasi daftar route publik.
- `middleware.ts` sudah memberi `Cache-Control: no-store` untuk semua `/api/*`
  (tidak perlu perubahan).

### 3.5 `docs/TENANT-ISOLATION.md` (task 2.5)

Isi minimum:

1. Sumber `TenantContext` (session `active_tenant_id` → membership ACTIVE).
2. Perilaku `withTenant`: allowlist model, override `tenant_id`, `create` dipaksa,
   update/delete lintas tenant → `CrossTenantAccessError`, `audit_logs` append-only.
3. Daftar call site `systemDb()` beserta alasan `SYSTEM:` dan aturan penambahan baru.
4. Model global (`User`, `Session`, `Permission`) dan mengapa di luar `withTenant`.
5. Contoh benar/salah + checklist review untuk service baru.
6. Batasan: isolasi **opt-in**; tidak ada jaminan kompilasi.
7. Tautkan dari `README.md` dan `docs/PHASE-1.md` §3/§4.

---

## 4. File yang kemungkinan perlu diubah

| File | Perubahan |
|---|---|
| `packages/auth/src/workspaces.ts` | `listWorkspaceMembers()` + validasi pagination |
| `packages/auth/src/index.ts` | ekspor fungsi/tipe baru |
| `packages/auth/src/route-policy.ts` | varian policy per-method + entri `/api/health/ready` |
| `packages/auth/src/route-policy.test.ts` | H1–H4 disesuaikan dengan method nyata; daftar publik + ready |
| `packages/auth/src/workspaces.test.ts` | test DB: list member tenant sendiri, pagination, isolasi |
| `apps/web/src/app/api/workspaces/route.ts` | tambah `GET` |
| `apps/web/src/app/api/workspaces/[id]/members/route.ts` | tambah `GET` |
| `apps/web/src/app/api/health/ready/route.ts` | **file baru** |
| `apps/web/test/route-policy.test.mjs` | daftar route publik + route baru |
| `docs/TENANT-ISOLATION.md` | **file baru** |
| `README.md`, `docs/PHASE-1.md` | tautan ke dokumen baru |
| `docs/PHASE-2.md` | catat hasil verifikasi (dibuat saat eksekusi) |

**Tidak boleh disentuh pada unit ini:** `schema.prisma`, folder `migrations/`,
`grants.sql`, `.env*`, dependency, `packages/permissions/src/index.ts`.

---

## 5. Acceptance Criteria

- [ ] `GET /api/workspaces` mengembalikan hanya workspace tempat user menjadi member
      `ACTIVE`; 401 tanpa sesi; tidak ada kebocoran tenant lain.
- [ ] `GET /api/workspaces/:id/members` mengembalikan member tenant aktif; `404` identik
      untuk workspace asing dan tidak ada; `403` bila tanpa `member.read`.
- [ ] VIEWER (punya `member.read`, tanpa `member.invite`) **dapat** memanggil GET members
      dan **tidak** dapat memanggil POST invite — membuktikan policy per-method bekerja.
- [ ] Pagination: default 50, maksimum 100; input tidak valid → 400; `total` benar;
      urutan stabil.
- [ ] Respons member tidak memuat hash/token/secret apa pun.
- [ ] `GET /api/health/ready` → 200 saat DB hidup, 503 saat DB mati, tanpa detail internal.
- [ ] Setiap route `/api` (termasuk yang baru) punya policy; test registry lulus.
- [ ] `docs/TENANT-ISOLATION.md` ada, memuat 7 poin §3.5, dan tertaut dari README/PHASE-1.
- [ ] `npm run typecheck` exit 0.
- [ ] Seluruh test lama + test baru lulus terhadap DB dev.
- [ ] Tidak ada migration baru, tidak ada perubahan `.env`, tidak ada dependency baru.

---

## 6. Testing Requirements

Wajib (dengan MariaDB dev aktif, **bukan** production):

1. **Test DB baru** di `packages/auth/src/workspaces.test.ts`:
   - `L1`: owner melihat member tenant sendiri; tenant lain tidak terlihat.
   - `L2`: pagination `limit=1&offset=1` mengembalikan baris kedua + `total` benar.
   - `L3`: `limit=0`, `limit=101`, `offset=-1`, `limit=abc` → 400.
   - `L4`: workspace asing vs tidak ada → 404 dengan pesan identik.
   - `L5`: response tidak memuat `passwordHash`/`tokenHash` (assert serialisasi JSON).
2. **Test policy**: VIEWER GET allowed, POST ditolak; OWNER keduanya allowed.
3. **Test readiness**: DB up → 200; DB down (client di-stub) → 503 tanpa detail.
4. **Test handler HTTP** (gap yang harus ditutup): impor `GET` dari file route dan panggil
   dengan `Request` + cookie/Bearer, assert status dan body. Ini memastikan kontrak route,
   bukan hanya service.
5. Regresi penuh: `npm test`, `npm test --workspace @absensi/web`,
   `npm run typecheck`, `npm run build`.

Catat di `docs/PHASE-2.md`: perintah, jumlah test, pass/fail, dan commit hash.

---

## 7. Security Requirements

- Tenant selalu dari sesi; `:id` hanya klaim → 404 identik (jangan 403 yang membocorkan
  keberadaan workspace).
- `member.read` dicek **sebelum** query; jangan pernah query lintas tenant lalu filter
  di aplikasi.
- Semua query list lewat `withTenant`; tidak boleh `systemDb()` untuk data member.
- Batasi field respons (allowlist), jangan spread objek Prisma mentah.
- Pagination wajib untuk mencegah dump seluruh member.
- Readiness tidak membocorkan detail DB; tetap publik tetapi tanpa auth.
- Jangan menambah rate limit setengah-setengah di unit ini — itu task 2.4. Catat sebagai
  risiko yang masih terbuka.
- Jangan menyentuh atau melemahkan test keamanan yang ada (F/H/CSRF/tenant).

---

## 8. Definition of Done

1. Semua acceptance criteria §5 terpenuhi dan dibuktikan dengan output perintah nyata.
2. Test baru mencakup service **dan** handler HTTP.
3. `typecheck`, seluruh test, dan `build` lulus; hasil dicatat di `docs/PHASE-2.md`.
4. `docs/TENANT-ISOLATION.md` selesai dan tertaut.
5. Tidak ada perubahan schema/migration/env/dependency.
6. Satu commit fokus: `feat(workspace): read APIs, readiness probe, tenant isolation docs (P2 2.1/2.3/2.5)`.
7. Status roadmap diperbarui: 2.1 PASS, 2.3 PASS, 2.5 PASS; task lain tetap apa adanya.
8. Audit trail: tidak ada aksi baru yang perlu diaudit pada unit ini (read-only +
   readiness). Bila kelak menambah audit, gunakan format `domain.verb`.

---

## 9. Risiko & rollback

| Risiko | Mitigasi |
|---|---|
| Perubahan policy registry memecah test lama | Perluas tipe secara kompatibel; perbarui H1–H4 dalam commit yang sama |
| Query member tanpa `withTenant` → kebocoran tenant | Test isolasi wajib; review manual call site |
| Readiness dianggap liveness oleh orkestrator | Pisahkan path (`/api/health` liveness, `/api/health/ready` readiness); dokumentasikan |
| Pagination tidak stabil → duplikasi data antar halaman | Order `createdAt, id`; test dua halaman |
| Test DB menghapus data dev | Jalankan hanya di DB dev port 3307; jangan arahkan `DATABASE_URL` ke DB lain |

**Rollback:** unit ini tidak menyentuh data/schema. Rollback = `git revert` satu commit.
Bila readiness bermasalah di deploy, hapus file route + entri registry (revert parsial);
tidak ada migrasi yang perlu dibatalkan.

---

## 10. Execution Prompt (siap dipakai)

> **Jangan jalankan prompt ini pada audit.** Prompt ini untuk sesi implementasi setelah
> pemilik proyek menyetujui laporan audit.

```text
Kamu adalah Senior Backend Engineer pada proyek aplikasi absensi GPS + Foto.
Repo: /home/reksa/absen-solusi/app (git root di app/).

BACA DULU (wajib):
- docs/PROJECT-CURRENT-STATE-AUDIT.md
- docs/NEXT-EXECUTION-PLAN.md
- docs/PHASE-1.md
- packages/auth/src/route-policy.ts, workspaces.ts, http.ts
- apps/web/src/app/api/workspaces/**, apps/web/src/app/api/health/route.ts

KONTEKS:
Phase aktif = Phase 2. Checkpoint terakhir PASS = Phase 1 7F. Phase 2 belum punya
checkpoint PASS. Roadmap LOCKED: jangan ubah nomor/nama Phase, jangan pindahkan fitur,
jangan buat Phase baru, jangan mulai Phase 3.

TUGAS (hanya ini):
1) Task 2.1 — tambahkan GET /api/workspaces dan GET /api/workspaces/:id/members
   sesuai §3.2–3.3 NEXT-EXECUTION-PLAN.md (permission member.read, claim 404 identik,
   pagination limit<=100, respons tanpa hash/token, query lewat withTenant).
2) Task 2.3 — tambahkan GET /api/health/ready memakai checkDatabaseHealth():
   200 {status:"ready",checks:{database:"up"}} / 503 {status:"not_ready",
   checks:{database:"down"}}, tanpa detail internal, publik + no-store.
3) Task 2.5 — tulis docs/TENANT-ISOLATION.md (7 poin §3.5) dan tautkan dari README
   serta docs/PHASE-1.md.
4) Perluas API_ROUTE_POLICIES menjadi per-method (TD-2-R8) dan sesuaikan test H1–H4
   serta apps/web/test/route-policy.test.mjs.

LARANGAN:
- Jangan mengubah schema.prisma, migrations, grants.sql, .env*, dependency.
- Jangan menyentuh packages/permissions/src/index.ts (TD-2-R1 keputusan pemilik).
- Jangan mengerjakan 2.2, 2.4, 2.6, 2.7, atau Phase 3.
- Jangan melemahkan/menghapus test yang ada.

PRASYARAT:
- Pastikan pekerjaan Phase 1 sudah di-commit terpisah.
- Nyalakan MariaDB dev (.devdb, port 3307) dan pastikan `npm test` hijau sebelum mulai.
- Jika DB tidak tersedia, BERHENTI dan laporkan; jangan mengklaim test lulus.

VERIFIKASI (wajib, tunjukkan output asli + exit code):
- npm run typecheck
- npm test
- npm test --workspace @absensi/web
- npm run build
- Test baru: list member tenant sendiri, pagination, 400 input invalid, 404 identik,
  VIEWER GET allowed/POST denied, readiness 200/503, plus test handler HTTP.

SELESAI BILA:
- Semua acceptance criteria §5 NEXT-EXECUTION-PLAN.md terpenuhi.
- docs/PHASE-2.md mencatat perintah, jumlah test, pass/fail.
- Satu commit: feat(workspace): read APIs, readiness probe, tenant isolation docs (P2 2.1/2.3/2.5)
- Laporkan: file diubah, hasil test nyata, risiko tersisa (rate limit & eskalasi role
  masih terbuka), dan konfirmasi tidak ada perubahan schema/env.
```

---

## 11. Checklist persetujuan

- [ ] Pemilik proyek menyetujui laporan audit.
- [ ] Keputusan TD-2-R1 (katalog/role absensi) dijadwalkan sebelum Phase 3.
- [ ] Perbaikan S-1 (eskalasi role) dijadwalkan sebelum rilis UI member.
- [ ] Unit 2.1/2.3/2.5 disetujui untuk dieksekusi.
