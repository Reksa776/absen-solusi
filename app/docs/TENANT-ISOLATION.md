# Isolasi Tenant — Semantik `withTenant`

**Status:** dokumentasi Task 2.5 (Phase 2), ditulis dari implementasi Phase 1–2.
**Sumber kebenaran kode:**
`packages/database/src/tenant-db.ts`, `packages/database/src/tenancy.ts`,
`packages/database/src/client.ts`, `packages/auth/src/http.ts`,
`packages/auth/src/workspaces.ts`.
**Berlaku untuk:** semua service yang membaca/menulis tabel ber-`tenant_id`.

Dokumen ini menjelaskan **apa yang dijamin kode**, bukan apa yang diharapkan.
Batasan yang belum diuji diberi label eksplisit.

---

## 1. Ringkasan jaminan

| Jaminan | Mekanisme | Status |
|---|---|---|
| Query tenant-scoped otomatis difilter `tenant_id` dari `TenantContext` | Prisma extension `withTenant` (`tenant-db.ts`) | Ada di kode |
| Nilai tenant dari pemanggil **ditimpa**, bukan digabung | `mergeWhere()` menaruh `tenantWhere()` paling akhir | Ada di kode |
| Model di luar allowlist ditolak | `TENANT_MODELS` + `TenantModelAccessError` | Ada di kode |
| Update/delete baris tenant lain gagal keras | `P2025` → `CrossTenantAccessError` | Ada di kode |
| `tenantId`/id workspace tidak bisa dipindah lewat data mutasi | `TenantWriteScopeError` sebelum query | Ada di kode + test T10–T12 |
| Nested write ditolak | `TenantNestedWriteError` | Ada di kode + test T13 |
| Raw query langsung pada client tenant ditolak | Proxy `TenantRawQueryError` | Ada di kode + test T14 |
| `audit_logs` tidak bisa diubah/dihapus lewat `withTenant` | `TenantAppendOnlyError` | Ada di kode |
| TenantContext tidak bisa dipalsukan service | tipe branded + `createTenantContext()` memvalidasi UUID dan mem-freeze | Ada di kode |
| Isolasi dijamin saat kompilasi | — | **Tidak ada**; isolasi bersifat **opt-in** |
| Tidak ada `systemDb()` baru tanpa alasan | — | **Tidak ada test/guard**; bergantung review |

Konsekuensi penting: **service yang lupa memakai `withTenant` tidak akan
ditolak compiler.** `systemDb()` adalah pintu unscoped dan harus diperlakukan
sebagai escape hatch, bukan default.

---

## 2. Dari mana `TenantContext` berasal

Alur aktual (`packages/auth/src/http.ts`, `requirePermission()`):

1. `requireApiSession()` memvalidasi cookie `aos_session` **atau** Bearer token
   lewat `validateSession()` (`session.ts`): revoked, TTL absolut 7 hari, idle
   24 jam.
2. `session.active_tenant_id` menjadi satu-satunya sumber tenant. **Tidak ada
   input klien** (path, query, body, header) yang boleh menentukan tenant.
3. Membership diverifikasi dengan `systemDb().workspaceMember.findFirst({ tenantId:
   session.activeTenantId, userId: session.userId, status: "ACTIVE" })`.
   Query ini sengaja belum memakai `withTenant` karena context belum terbentuk.
4. `resolveMemberPermissions(systemDb(), tenantId, memberId)` mengambil role dan
   permission efektif dari DB pada setiap request.
5. `createTenantContext()` memvalidasi `tenantId`/`userId`/`memberId` sebagai
   UUID, mem-freeze objek, lalu mengembalikan `{ ctx, member }`.

Route yang menerima `:id` **wajib** memanggil `assertWorkspaceClaim(ctx, id)`
(`workspaces.ts`). Fungsi ini hanya membandingkan klaim URL dengan
`ctx.tenantId` dan melempar `404 WORKSPACE_NOT_FOUND` — pesan yang sama untuk
workspace asing maupun yang tidak ada, sehingga keberadaan workspace tidak
bocor.

> `:id` **bukan** sumber otoritas. Bila `assertWorkspaceClaim` dilewati,
> `withTenant` tetap memakai `ctx.tenantId`; hasilnya bukan kebocoran lintas
> tenant, tetapi kontrak API salah (path B mengembalikan data A).

---

## 3. Perilaku `withTenant(ctx, work)`

`withTenant` membuat Prisma client yang di-extend, lalu menyerahkannya ke
`work`. Semua operasi pada model tenant-scoped melewati extension:

| Operasi | Perilaku |
|---|---|
| `findMany`, `findFirst`, `findFirstOrThrow`, `findUnique`, `findUniqueOrThrow`, `count`, `aggregate`, `groupBy` | `where` digabung dengan tenant; nilai tenant pemanggil ditimpa |
| `create` | `data` dipaksa berisi tenant context |
| `createMany` | setiap baris `data` dipaksa berisi tenant context |
| `updateMany`, `deleteMany` | `where` digabung dengan tenant; `data.tenantId` ditolak |
| `update`, `delete` | `where` digabung; baris tenant lain → `P2025` → `CrossTenantAccessError`; `data.tenantId` ditolak |
| `upsert` | `where` digabung; `update.tenantId` ditolak; `create` dipaksa tenant context |
| Operasi lain (mis. `findRaw`, `count` dengan argumen tak dikenal) | `TenantModelAccessError` |
| `AuditLog` pada `update`/`delete`/`upsert`/`updateMany`/`deleteMany` | `TenantAppendOnlyError` |

Detail penting:

- **`Workspace` istimewa.** Model ini adalah agregat tenant itu sendiri, jadi
  filternya `{ id: tenantId }`, bukan `{ tenantId }`. `create` pada `Workspace`
  juga memaksa `id = ctx.tenantId`, sehingga `withTenant` tidak bisa membuat
  workspace dengan id sembarang.
- **Tidak ada overload tanpa context dan tidak ada flag opt-out.** Satu-satunya
  cara melewati filter adalah `systemDb()`.
- **Allowlist model:** `Workspace`, `WorkspaceMember`, `WorkspaceInvitation`,
  `Role`, `RolePermission`, `MemberRole`, `AuditLog`, `BackgroundJob`.
  `BackgroundJobAttempt` tidak punya `tenant_id`, jadi bukan model tenant-scoped.
- **Model global** (`User`, `Session`, `Permission`) **tidak** ada di allowlist
  dan selalu diakses lewat `systemDb()`. Ketiganya platform-level: user bisa
  menjadi anggota banyak workspace, session tidak punya `tenant_id`, dan
  `permissions` adalah katalog aplikasi.
- `writeAudit()` menerima writer opsional. Aksi berisiko
  (`workspace.create`, `role.change`, `ownership.transfer`) mengirim transaction
  client (`tx`) sehingga audit commit/rollback bersama operasi. Aksi lain tetap
  memakai `systemDb()`; `tenant_id` berasal dari `ctx` yang sudah terverifikasi.

---

## 4. Call site `systemDb()` yang ada

Setiap pemanggilan wajib punya komentar `SYSTEM:` yang menjelaskan alasannya.

| File / fungsi | Alasan | Boleh menambah? |
|---|---|---|
| `session.ts` — `createSession`, `validateSession`, `rotateSession`, `revokeSession`, `revokeAllSessionsForUser` | tabel `sessions` platform-level, tanpa `tenant_id` | Ya, untuk session |
| `session.ts` — `loadWorkspacesForUser` | daftar workspace milik user lintas tenant (dipanggil setelah sesi valid) | Ya, pola sama |
| `http.ts` — `requirePermission` | membership + permission sebelum context terbentuk | Tidak; ini satu-satunya jalur |
| `users.ts` — `registerBootstrap`, `loginWithPassword` | autentikasi platform-level sebelum tenant diketahui | Tidak untuk data tenant |
| `workspaces.ts` — `createWorkspace` | workspace belum ada; provisioning + membership + role dalam satu transaksi | Tidak untuk read tenant |
| `database/audit.ts` — `writeAudit` | satu-satunya writer `audit_logs` (append-only) | Tidak; tambah aksi, bukan writer baru |
| `database/health.ts` — `checkDatabaseHealth`/`checkReadiness` | `SELECT 1`, tanpa tabel tenant | Ya, probe saja |
| `database/tenant-db.ts` — `withTenant` | client dasar untuk extension | Tidak |
| `apps/web/.../api/auth/me/route.ts`, `apps/web/src/app/page.tsx` | identitas user untuk sesi yang sudah tervalidasi | Hati-hati; hanya field user sendiri |

**Aturan penambahan call site baru:**

1. Harus platform-level (User/Session/Permission), pre-context (login,
   bootstrap, membership check), provisioning, atau probe.
2. **Dilarang** untuk membaca/menulis data tenant setelah `ctx` tersedia.
3. Wajib komentar `SYSTEM:` berisi alasan, bukan sekadar label.
4. Jangan menyisipkan input pengguna ke `where` tanpa validasi; untuk data
   tenant, gunakan `ctx`.
5. Bila ragu, gunakan `withTenant`.

---

## 5. Contoh yang benar

Daftar member tenant aktif (`packages/auth/src/workspaces.ts`,
`listWorkspaceMembers`):

```ts
assertWorkspaceClaim(input.ctx, input.workspaceId);

return withTenant(input.ctx, async (db) => {
  const total = await db.workspaceMember.count();          // otomatis tenant
  const rows = await db.workspaceMember.findMany({          // otomatis tenant
    include: { user: { select: { id: true, name: true, email: true } } },
    take: limit,
    skip: offset,
  });
  // ...allowlist field, bukan spread objek Prisma
});
```

Undangan member (`inviteMember`) juga memakai pola yang sama: klaim dicek,
lalu `withTenant`, lalu audit ditulis setelah transaksi.

## 6. Contoh yang salah

```ts
// SALAH: unscoped, membocorkan seluruh tenant.
const members = await systemDb().workspaceMember.findMany();

// SALAH: query lintas tenant lalu difilter di aplikasi.
const rows = await systemDb().workspaceMember.findMany();
const safe = rows.filter((row) => row.tenantId === ctx.tenantId);

// SALAH: menganggap :id sebagai otoritas.
await withTenant({ ...ctx, tenantId: params.id }, ...); // context palsu

// SALAH: melewati claim, lalu mengira path menentukan tenant.
const rows = await withTenant(ctx, (db) => db.workspaceMember.findMany());
// path /api/workspaces/B/members tetap mengembalikan data tenant A

// SALAH: mengembalikan objek Prisma mentah (password_hash ikut).
return jsonResponse(rows);
```

---

## 7. Kesalahan isolasi yang paling mungkin terjadi

| Pola | Akibat | Pencegahan |
|---|---|---|
| `systemDb()` untuk list/read setelah `ctx` ada | kebocoran seluruh tenant | review + test isolasi |
| Filter tenant dilakukan di aplikasi | data tenant lain sempat terbaca | query harus sudah terfilter |
| Lupa `assertWorkspaceClaim` | kontrak salah (bukan bocor), 404 tidak konsisten | test foreign vs missing |
| `update` dengan `data: { tenantId: lain }` | ditolak `TenantWriteScopeError` (T10) | guard `data` sudah aktif |
| `upsert` dengan `create.tenantId` | create dipaksa tenant context; update `tenantId` ditolak (T11–T12) | guard `upsert` sudah aktif |
| Nested write (`create: { members: { create: ... } }`) | ditolak `TenantNestedWriteError` (T13) | guard nested sudah aktif |
| `$queryRaw` / `$executeRaw` langsung | ditolak `TenantRawQueryError` (T14) | guard raw sudah aktif |
| `P2025` tidak ditangani | error 500, bukan 404/403 | tangkap `CrossTenantAccessError` |
| Mengembalikan objek Prisma | hash/token bocor ke JSON | allowlist field |

---

## 8. Batasan yang terverifikasi dari kode

Batasan berikut **terbukti dari implementasi saat ini**, bukan asumsi:

1. **Mutasi `data` sudah dijaga (T10–T12).** `update`, `updateMany`, dan
   `upsert` menolak `tenantId`/id workspace di data; `upsert.create` dipaksa
   memakai tenant context. Ini diverifikasi terhadap MariaDB nyata.
2. **Nested write sudah ditolak (T13).** Relasi bertingkat tidak dijalankan;
   service harus menulis eksplisit per model.
3. **Raw query langsung sudah ditolak (T14).** Proxy `withTenant` melempar
   `TenantRawQueryError` untuk `$queryRaw`, `$queryRawUnsafe`, `$executeRaw`,
   dan `$executeRawUnsafe`.
4. **Raw di dalam `$transaction` belum dijaga otomatis.** Callback transaksi
   memakai client Prisma biasa; satu-satunya pemakaian saat ini adalah lock
   `workspaceId` yang sudah tervalidasi di `changeMemberRole`/`transferOwnership`.
   Raw baru di dalam transaksi dilarang oleh review dan bukan jalur data tenant.
5. **Tidak ada jaminan kompilasi.** Service bisa memakai `systemDb()` kapan saja.
6. **`audit_logs` hanya append-only di level aplikasi.** Grant DB
   (`grants.sql`) adalah lapisan kedua; di luar cakupan dokumen ini.
7. **Perilaku `$transaction` interaktif pada client hasil extension belum
   diverifikasi di repo ini.** Jangan menganggap transaksi otomatis ter-scope;
   bila memakai transaksi, uji eksplisit.

---

## 9. Checklist review service baru

- [ ] Fungsi menerima `TenantContext`, bukan `tenantId` mentah dari route.
- [ ] Route memanggil `requirePermission(request, "<permission>")`.
- [ ] `:workspaceId` divalidasi dengan `assertWorkspaceClaim`.
- [ ] Semua query data tenant memakai `withTenant`; tidak ada `systemDb()`.
- [ ] Tidak ada `where: { tenantId }` yang mengandalkan input klien.
- [ ] Tidak mengirim `tenantId` di `data` update/upsert.
- [ ] Tidak memakai nested write untuk model tenant-scoped.
- [ ] Hasil query dipetakan ke allowlist field (tanpa hash/token).
- [ ] List memakai pagination dengan batas maksimum.
- [ ] Error lintas tenant dipetakan ke 404 identik, bukan 403/500.
- [ ] Ada test DB: tenant sendiri terlihat, tenant lain tidak, foreign vs
      missing identik.
- [ ] `SYSTEM:` hanya muncul dengan alasan yang sesuai §4.

---

## 10. Status verifikasi

- Dokumen ini diperbarui setelah perbaikan C-01 pada commit `153084b`
  (tag `checkpoint-1i`).
- Test isolasi T10–T14 berjalan terhadap MariaDB nyata dan lulus; suite
  database 26/26, auth 79/79, web 2/2, permissions 9/9 (`npm run test:ci`).
- Probe manual `update({ data: { tenantId: B } })` mengembalikan
  `TenantWriteScopeError`, bukan `SUCCESS`.
- Batas 4 (raw di dalam transaksi) tetap berlaku dan harus ditinjau saat
  menambah transaksi baru.
