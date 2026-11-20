# Phase 2 — Security Remediation Report: Critical S-1

**Tanggal:** 2026-11-19
**Unit:** Security Remediation S-1 (Phase 2)
**Git root:** `app/`
**HEAD:** `47e77c0527a4510c23d31017e78feaacdd978fd2` (tidak berubah)
**Status akhir:** **PASS WITH LIMITATIONS**

> Remediasi ini tetap di Phase 2. Task 2.2, 2.4, 2.6, 2.7 dan Phase 3–8 tidak
> dikerjakan. Tidak ada migration, perubahan schema, perubahan `.env`,
> dependency baru, atau perubahan Git history.

---

## 1. Root Cause Analysis

S-1 bukan satu bug tunggal, melainkan tiga celah yang saling memperkuat:

1. **Tidak ada hierarki role.** `changeMemberRole()` hanya memvalidasi bahwa
   `role` ada di katalog (`assertRoleKey`), lalu mengganti assignment. Tidak ada
   perbandingan peringkat aktor vs role yang diberikan.
2. **`role.manage` dimiliki owner dan admin.** Di katalog, `WORKSPACE_ADMIN`
   mendapat semua permission kecuali `workspace.manage`, termasuk `role.manage`.
   Artinya admin memang role manager, tetapi tanpa batas apa yang boleh
   diberikan.
3. **Tidak ada konsep ownership khusus.** `WORKSPACE_OWNER` diperlakukan sama
   seperti role lain, padahal ia adalah pemegang kontrol workspace. Tidak ada
   jalur transfer ownership, tidak ada proteksi owner terakhir, dan tidak ada
   invariant “workspace selalu punya owner”.

Jalur kedua ditemukan saat audit: **`inviteMember()` juga menerima role apa
pun**, termasuk `WORKSPACE_OWNER`. Begitu Task 2.2 (accept invitation)
diimplementasikan, undangan owner akan menjadi eskalasi privilege kedua.

Akar masalahnya: otorisasi hanya memeriksa **apakah aktor punya permission**,
bukan **apakah aktor berwenang atas role target**.

---

## 2. Affected Endpoints

| Endpoint | Permission | Dampak sebelum perbaikan |
|---|---|---|
| `PATCH /api/workspaces/:id/members/:memberId/role` | `role.manage` | Admin dapat menetapkan `WORKSPACE_OWNER`; admin dapat menurunkan owner; admin dapat mengubah admin lain |
| `POST /api/workspaces/:id/members` | `member.invite` | Undangan dapat membawa `WORKSPACE_OWNER` atau role setara aktor |
| `POST /api/workspaces/:id/ownership/transfer` | `workspace.manage` | **Baru** — satu-satunya jalur sah memindahkan ownership |

Tidak ada endpoint penghapusan member (`DELETE .../members/:id`) di repo ini;
dikonfirmasi dengan pemindaian folder `apps/web/src/app/api`. Karena itu
“last owner tidak dapat dihapus” saat ini bersifat struktural: tidak ada operasi
hapus yang bisa menghilangkan owner.

Endpoint lain yang menulis `member_roles` bersifat provisioning, bukan role
management: `createWorkspace()` dan `registerBootstrap()` (owner pertama), serta
`seedTenant()`/`seedMember()` (test helper).

---

## 3. Security Design

Prinsip yang dipakai:

1. **Keputusan murni, dapat diuji tanpa DB.** Seluruh aturan hierarki berada di
   `packages/auth/src/role-policy.ts` sebagai fungsi `evaluate*` yang
   mengembalikan `{ allowed: true }` atau `{ allowed: false, status, code,
   message }`. Service menerjemahkannya menjadi `HttpError`.
2. **Defense in depth.** Route tetap memakai `requirePermission`; service
   memeriksa ulang hierarki dan (untuk transfer) kepemilikan role owner secara
   eksplisit dari `ctx.roleKeys`. Permission saja tidak cukup.
3. **Satu jalur ownership.** `WORKSPACE_OWNER` tidak dapat diberikan lewat role
   change maupun invitation. Hanya `transferOwnership()` yang boleh
   memindahkannya.
4. **Invariant owner.** Transfer berjalan dalam satu transaksi: target menjadi
   owner, aktor menjadi admin, lalu jumlah owner diverifikasi minimal satu.
5. **Tanpa schema baru.** Semua data yang dibutuhkan (role, assignment, status
   member) sudah ada. Tidak perlu migration.

Kode error baru:

| Code | Status | Arti |
|---|---|---|
| `OWNERSHIP_TRANSFER_REQUIRED` | 403 | Percobaan memberi owner lewat role change/invitation |
| `ROLE_HIERARCHY_VIOLATION` | 403 | Role target setara/lebih tinggi dari aktor |
| `LAST_OWNER_PROTECTED` | 409 | Demosi owner terakhir |
| `SELF_OWNERSHIP_TRANSFER` | 400 | Transfer ke diri sendiri |
| `ALREADY_OWNER` | 409 | Target sudah owner |
| `OWNERSHIP_INVARIANT` | 409 | Jumlah owner setelah transfer tidak valid |

---

## 4. Files Changed

### Baru

| File | Isi |
|---|---|
| `packages/auth/src/role-policy.ts` | Peringkat role + evaluasi role change, invitation, transfer |
| `packages/auth/src/role-policy.test.ts` | 11 test regresi DB-free (S1-1…S1-11) |
| `apps/web/src/app/api/workspaces/[id]/ownership/transfer/route.ts` | Endpoint transfer ownership |
| `docs/PHASE-2-SECURITY-S1-REMEDIATION-REPORT.md` | Laporan ini |

### Diubah

| File | Perubahan |
|---|---|
| `packages/auth/src/workspaces.ts` | Guard invitation, guard + re-check transaksi pada role change, `transferOwnership()` |
| `packages/auth/src/index.ts` | Ekspor policy dan service transfer |
| `packages/auth/src/workspaces.test.ts` | 6 test DB regresi S-1 (S1-D1…S1-D6), belum dieksekusi |
| `packages/auth/src/route-policy.ts` | Entry policy endpoint transfer |
| `packages/auth/src/route-policy.test.ts` | H4 memverifikasi policy transfer |

### Tidak disentuh

`schema.prisma`, `migrations/`, `grants.sql`, `.env*`, `package.json`/
`package-lock.json`, `packages/permissions/src/index.ts`.

---

## 5. Implementation Details

### 5.1 Hierarki role

`ROLE_RANK` (sengaja eksplisit, bukan turunan jumlah permission):

| Role | Rank |
|---|---|
| `WORKSPACE_OWNER` | 40 |
| `WORKSPACE_ADMIN` | 30 |
| `AFFILIATE_MANAGER` | 20 |
| `BUSINESS_DEVELOPMENT` | 20 |
| `ANALYST` | 20 |
| `VIEWER` | 10 |
| tidak dikenal | 0 |

`highestRoleRank()` dipakai untuk aktor dan target; member dengan banyak role
dinilai dari role tertinggi.

### 5.2 Role change (`changeMemberRole`)

Urutan evaluasi (`evaluateRoleChange`):

1. target = aktor → `400 SELF_ROLE_CHANGE`;
2. role berikutnya = owner → `403 OWNERSHIP_TRANSFER_REQUIRED`;
3. rank aktor < admin → `403 FORBIDDEN`;
4. target owner dan `ownerCount <= 1` → `409 LAST_OWNER_PROTECTED`;
5. rank role berikutnya >= rank aktor → `403 ROLE_HIERARCHY_VIOLATION`;
6. rank target >= rank aktor → `403 ROLE_HIERARCHY_VIOLATION`.

Service mengambil `ownerCount` dari `member_roles` dengan `tenantId` eksplisit
hanya bila target memegang owner. Di dalam transaksi, jumlah owner dihitung
ulang sebelum assignment dihapus; bila `<= 1`, transaksi dibatalkan. `deleteMany`
kini menyertakan `tenantId` eksplisit (defense in depth, tidak lagi hanya
mengandalkan extension).

No-op (role sama persis) tetap mengembalikan `changed: false` tanpa menulis
audit; ini tidak memberi privilege baru.

### 5.3 Invitation (`inviteMember`)

`evaluateInvitationRole` dijalankan sebelum query:

- role `WORKSPACE_OWNER` → `403 OWNERSHIP_TRANSFER_REQUIRED`;
- rank aktor < admin → `403 FORBIDDEN`;
- rank role undangan >= rank aktor → `403 ROLE_HIERARCHY_VIOLATION`.

Dengan demikian admin dapat mengundang manager/analyst/viewer, tetapi tidak
admin/owner. Owner dapat mengundang admin ke bawah.

### 5.4 Transfer ownership (`transferOwnership`)

- Route: `POST /api/workspaces/:id/ownership/transfer`, permission
  `workspace.manage` (hanya owner di katalog saat ini).
- Service memeriksa ulang `ctx.roleKeys` memuat `WORKSPACE_OWNER`.
- `memberId` divalidasi UUID sebelum query.
- Target harus member tenant yang sama, `ACTIVE`, dan belum owner.
- Transaksi:
  1. hapus semua role target, beri `WORKSPACE_OWNER`;
  2. hapus semua role aktor, beri `WORKSPACE_ADMIN`;
  3. hitung owner; bila `< 1` → rollback.
- Audit `ownership.transfer` ditulis setelah commit (best-effort, pola yang
  sama dengan audit lain).

### 5.5 Session invalidation / rotation

**Evaluasi:** tidak diperlukan untuk perubahan role saat ini.
`requirePermission()` memanggil `resolveMemberPermissions()` dari database pada
**setiap request** (`packages/auth/src/http.ts`), sehingga role baru berlaku
pada request berikutnya dengan token yang sama. Tidak ada cache permission yang
bisa basi.

`rotateSession()` ada tetapi tidak dipanggil karena:

- server tidak menyimpan token mentah target, sehingga tidak bisa merotasi token
  pengguna lain;
- `revokeAllSessionsForUser()` akan mengeluarkan target dari semua perangkat —
  dampak operasional besar tanpa manfaat keamanan selama permission dibaca
  segar dari DB.

**Kapan harus ditinjau ulang:** bila kelak permission di-cache di session/JWT
atau ada token berisi role. Saat itu rotasi/revocation wajib. Dicatat sebagai
TD-S1-R4.

---

## 6. Authorization Matrix

### Role change (PATCH role)

| Aktor | → VIEWER/ANALYST/MANAGER | → WORKSPACE_ADMIN | → WORKSPACE_OWNER | Target ADMIN | Target OWNER |
|---|---|---|---|---|---|
| OWNER | Ya | Ya | **Tidak** (transfer) | Ya | Tidak (setara) |
| ADMIN | Ya | **Tidak** (setara) | **Tidak** | **Tidak** | **Tidak** |
| MANAGER/ANALYST/VIEWER | Tidak | Tidak | Tidak | Tidak | Tidak |
| Tanpa sesi | 401 | 401 | 401 | 401 | 401 |

### Invitation (POST members)

| Aktor | VIEWER/ANALYST/MANAGER | ADMIN | OWNER |
|---|---|---|---|
| OWNER | Ya | Ya | **Tidak** |
| ADMIN | Ya | **Tidak** | **Tidak** |
| lainnya | Tidak | Tidak | Tidak |

### Ownership transfer (POST ownership/transfer)

| Aktor | Target ACTIVE non-owner | Target owner | Target nonaktif | Diri sendiri |
|---|---|---|---|---|
| OWNER | Ya | 409 `ALREADY_OWNER` | 404 | 400 |
| ADMIN | 403 | 403 | 403 | 403 |
| lainnya | 403 | 403 | 403 | 403 |

Catatan: route memakai `workspace.manage`, sehingga aktor non-owner sudah
ditolak sebelum service; pemeriksaan role owner di service adalah lapisan kedua
bila katalog permission berubah di masa depan.

---

## 7. Last-owner Protection

Tiga lapisan:

1. **Struktural:** tidak ada endpoint hapus member, jadi owner tidak bisa
   “dihapus”.
2. **Hierarki:** tidak ada aktor berperingkat lebih tinggi dari owner; aktor
   owner tidak boleh mengubah dirinya sendiri dan tidak boleh mengubah owner
   lain (rank setara). Praktisnya owner tidak dapat didemosi lewat PATCH role.
3. **Eksplisit:** bila target memegang owner dan `ownerCount <= 1`, keputusan
   mengembalikan `409 LAST_OWNER_PROTECTED`; jumlah owner dihitung ulang di
   dalam transaksi sebelum assignment dihapus.

Transfer ownership tidak melanggar invariant: owner baru dibuat sebelum owner
lama diturunkan, dan transaksi memverifikasi minimal satu owner sebelum commit.

**Batasan:** query hitung owner tidak memakai `SELECT ... FOR UPDATE`, sehingga
skenario dua perubahan bersamaan secara teori masih bisa lolos. Saat ini jalur
yang tersedia tidak memungkinkan dua aktor berbeda mendemosi owner (hierarki),
sehingga risiko praktisnya rendah. Dicatat sebagai TD-S1-R2.

---

## 8. Audit Trail

| Aksi | Kapan | Metadata |
|---|---|---|
| `role.change` | PATCH role berhasil dan benar-benar berubah | `from` (role id lama), `to` (role key baru) |
| `member.invite` | Undangan dibuat | `email`, `roleKey` (tidak ada token/hash) |
| `ownership.transfer` | Transfer berhasil | `fromMemberId`, `toMemberId`, `fromRoleKey`, `toRoleKey`, `previousTargetRoleKeys` |
| `workspace.create`, `auth.*` | Tidak berubah | — |

- `actorUserId`/`actorMemberId` diisi dari `ctx`; `ip` di-hash SHA-256.
- Tidak ada token, hash, atau password di metadata (redaksi otomatis tetap
  berlaku).
- Percobaan yang **ditolak** belum diaudit; hanya dikembalikan sebagai error.
  Ini konsisten dengan pola Phase 1, tetapi dicatat sebagai TD-S1-R3.

---

## 9. Regression Tests

### Dijalankan — DB-free, PASS

`node --test dist/security.test.js dist/route-policy.test.js dist/role-policy.test.js`
→ **22/22 PASS** (11 S-1 + 6 H + 5 F).

| ID | Skenario | Hasil |
|---|---|---|
| S1-1 | Hierarki lengkap; owner tertinggi; role tak dikenal = 0 | PASS |
| S1-2 | Admin memberi owner lewat role change | PASS (403) |
| S1-3 | Owner pun tidak bisa memberi owner lewat role change | PASS (403) |
| S1-4 | Admin menaikkan member ke admin | PASS (403) |
| S1-5 | Admin mengubah admin lain / owner | PASS (403) |
| S1-6 | Owner→admin dan admin→viewer tetap diizinkan | PASS |
| S1-7 | Self-change dan aktor non-manager ditolak | PASS |
| S1-8 | Owner terakhir tidak dapat diturunkan | PASS (409) |
| S1-9 | Invitation owner / role setara ditolak | PASS |
| S1-10 | Hanya owner dapat transfer | PASS |
| S1-11 | Transfer ke self / nonaktif / owner lain ditolak | PASS |

Test policy H1/H6 juga memastikan endpoint transfer baru punya deklarasi dan
method-nya benar-benar diekspor.

### Ditulis — DB, NOT VERIFIED

`packages/auth/src/workspaces.test.ts` → S1-D1…S1-D6. **Belum dieksekusi**
karena approval melarang perubahan/penghapusan data dan harness memanggil
`resetDatabase()` pada database development.

| ID | Skenario |
|---|---|
| S1-D1 | Admin → owner ditolak; assignment target tidak berubah; owner tetap 1 |
| S1-D2 | Admin tidak bisa memberi admin, mengubah admin lain, atau owner |
| S1-D3 | Admin tetap bisa memberi ANALYST (regression fitur) |
| S1-D4 | Invitation owner/admin ditolak; invitation viewer diterima |
| S1-D5 | Transfer berhasil: tepat 1 owner, aktor jadi admin, audit tertulis |
| S1-D6 | Transfer oleh non-owner/self/nonaktif/owner lain ditolak |

### Verifikasi lain

| Perintah | Hasil |
|---|---|
| `npm run build --workspace @absensi/auth` | exit 0 |
| `npm run typecheck` (5 workspace) | exit 0 |
| `node --test dist/health.test.js` | 2/2 PASS |
| `npm test --workspace @absensi/web` | 2/2 PASS |
| `npm run build --workspace @absensi/web` | exit 0; route transfer terdaftar |

Tidak ada test lama yang dihapus, dilemahkan, atau di-skip.

---

## 10. Security Verification

| Kontrol | Bukti | Status |
|---|---|---|
| Admin tidak bisa memberi owner | `evaluateRoleChange` + S1-2 PASS | Terverifikasi (unit) |
| Owner pun tidak bisa memberi owner via PATCH | S1-3 PASS | Terverifikasi (unit) |
| Admin tidak bisa memberi role setara | S1-4/S1-5 PASS | Terverifikasi (unit) |
| Admin tidak bisa mengubah owner | S1-5 PASS | Terverifikasi (unit) |
| Self-change diblokir | S1-7 + kode lama | Terverifikasi (unit) |
| Invitation tidak membawa owner | S1-9 PASS | Terverifikasi (unit) |
| Hanya owner dapat transfer | S1-10 PASS | Terverifikasi (unit) |
| Target transfer valid | S1-11 PASS | Terverifikasi (unit) |
| Last-owner dilindungi | S1-8 PASS + re-check transaksi | Terverifikasi (unit) |
| Audit perubahan penting | kode `role.change` + `ownership.transfer` | Ada di kode; S1-D5 NOT VERIFIED |
| Efek role langsung berlaku | permission dibaca per request (`http.ts`) | Terverifikasi dari kode |
| Rate limit role/invite | belum ada (Task 2.4) | **Terbuka** |

---

## 11. Remaining Limitations

1. **6 test DB S-1 dan seluruh suite DB (total 56 test) NOT VERIFIED.** Tidak
   ada klaim bahwa jalur end-to-end sudah terbukti runtime.
2. **Belum ada test handler HTTP** untuk endpoint transfer; kontrak route
   diverifikasi lewat typecheck, build, dan policy registry.
3. **Race last-owner belum diuji dengan konkurensi nyata**; belum memakai row
   lock. Lihat TD-S1-R2.
4. **Percobaan ditolak tidak diaudit** (TD-S1-R3).
5. **Tidak ada rotasi/revocation sesi**; aman selama permission dibaca dari DB
   setiap request (TD-S1-R4).
6. **Data lama mungkin sudah memiliki beberapa owner** akibat S-1. Kode baru
   mencegah perubahan lebih lanjut, tetapi pembersihan data tidak dilakukan
   (dilarang menghapus data) dan transfer ke owner yang sudah ada ditolak.
7. **Katalog RBAC affiliate tidak diubah** (sesuai aturan). Role absensi tetap
   keputusan Phase 3 (TD-2-R1).
8. **Audit best-effort** — kegagalan audit tidak membatalkan perubahan
   (TD-1-R14).
9. **Tidak ada endpoint hapus/keluar member**, sehingga belum ada alur
   “owner keluar workspace”; perlu dirancang bersama accept-invitation.

---

## 12. Git Status

**HEAD:** `47e77c0527a4510c23d31017e78feaacdd978fd2` — tidak berubah.

Perubahan S-1 menambah:

```
 M packages/auth/src/index.ts
 M packages/auth/src/route-policy.ts
 M packages/auth/src/route-policy.test.ts
 M packages/auth/src/workspaces.ts
 M packages/auth/src/workspaces.test.ts
?? packages/auth/src/role-policy.ts
?? packages/auth/src/role-policy.test.ts
?? apps/web/src/app/api/workspaces/[id]/ownership/
?? docs/PHASE-2-SECURITY-S1-REMEDIATION-REPORT.md
```

Perubahan lokal Phase 1, Unit 2A, dan dokumen audit tetap utuh. Tidak ada
`git reset`, `checkout`, `stash`, `clean`, `commit`, atau `push`.

---

## 13. Final Verdict

**PASS WITH LIMITATIONS.**

S-1 dimitigasi di lapisan kebijakan dan service:

- hierarki role menggantikan “permission saja”;
- `WORKSPACE_OWNER` tidak dapat diberikan lewat PATCH role maupun invitation;
- ownership hanya berpindah lewat endpoint transfer khusus owner;
- owner terakhir dilindungi secara struktural, hierarkis, dan eksplisit;
- perubahan penting diaudit.

**Security regression tests yang dieksekusi lulus 11/11**, ditambah 11 test
F/H dan 4 test readiness/web. Namun **6 test regresi DB belum dijalankan**, dan
race konkurensi belum diuji. Karena itu S-1 **belum boleh ditandai “closed”
secara end-to-end** sampai suite DB dijalankan pada database dev dan hasilnya
dicatat. Tidak ada migration yang dibutuhkan untuk remediasi ini.

**STOP.** Unit 2B tidak dimulai. Menunggu persetujuan pemilik proyek.
