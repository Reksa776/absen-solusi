# Phase 2 — S-1 Verification Report: Isolated Database & Concurrency Audit

**Checkpoint:** S-1 Verification
**Tanggal:** 2026-11-19
**Git root:** `app/`
**Branch:** `main`
**HEAD:** `47e77c0527a4510c23d31017e78feaacdd978fd2`
**Status akhir:** **PASS WITH LIMITATIONS**

> Checkpoint ini adalah verifikasi dan audit keamanan. Unit 2B (Task 2.2/2.4/2.6/2.7)
> dan Phase 3–8 **tidak** dimulai. Tidak ada migration baru, perubahan schema,
> perubahan `.env`, dependency baru, commit, atau push.

---

## 1. Executive Summary

Verifikasi dilakukan pada instance MariaDB terpisah di `/tmp`, port **3317**,
database **`absensi_s1_verify_20261119`**, dengan user khusus `s1_migrator` dan
`s1_app`. Database development (port 3307) tidak pernah dinyalakan; server
sistem di port 3306 tidak pernah dihubungi.

Hasil utama:

| Area | Hasil |
|---|---|
| S1-D1…S1-D9 | **9/9 PASS** setelah satu koreksi ekspektasi test |
| Suite auth lengkap | **66/66 PASS** (64 test + 2 artefak dist) |
| Suite database lengkap | **21/21 PASS** (19 test + 2 artefak dist) |
| Suite web / permissions | **2/2** dan **9/9 PASS** |
| Typecheck 5 workspace | **exit 0** |
| Audit konkurensi | **Defect ditemukan dan diperbaiki** |
| Invariant owner | **20/20 eksperimen tepat 1 owner** |
| Rollback transaksi | **PASS** (S1-D9) |
| Audit saat DB audit gagal | Transfer tetap commit, audit hilang (best-effort) |

**Temuan kritis:** dua request transfer ownership bersamaan dapat menghasilkan
**dua owner** pada 5 dari 8 iterasi baseline. Ini melanggar invariant
“tepat satu owner”. Perbaikan sempit diterapkan: lock baris `workspaces`
(`SELECT … FOR UPDATE`) di dalam transaksi, lalu verifikasi ulang aktor masih
owner. Setelah perbaikan, 20/20 iterasi berakhir dengan tepat satu owner dan
tidak ada `P2010`/deadlock.

**S-1 belum ditandai “closed” penuh** karena audit ownership masih best-effort
dan belum ada test handler HTTP. Namun tidak ada lagi invariant violation yang
dapat direproduksi.

---

## 2. Original S-1 Limitations

Sebelum checkpoint ini:

1. Enam test DB S1-D1…S1-D6 ditulis tetapi **NOT VERIFIED** karena harness
   memanggil `resetDatabase()` pada database development.
2. Seluruh suite DB (saat itu 56 test) **NOT VERIFIED**.
3. TD-S1-R2: race last-owner/ownership belum diuji dengan konkurensi nyata.
4. Tidak ada test handler HTTP untuk endpoint transfer.
5. Audit bersifat best-effort (TD-1-R14), belum dievaluasi untuk transfer.

Checkpoint ini menutup butir 1–3 dan mengevaluasi butir 5. Butir 4 tetap
terbuka.

---

## 3. Git Baseline and Working-Tree Status

**Sebelum work:**

```
HEAD   47e77c0527a4510c23d31017e78feaacdd978fd2
branch main
```

Working tree sudah berisi perubahan Phase 1, Unit 2A, dan S-1 (tidak bersih).
Tidak ada perubahan yang dihapus atau ditimpa.

**Sesudah work:** HEAD dan branch sama. Perubahan baru checkpoint ini:

```
 M packages/auth/src/test-support.ts
 M packages/auth/src/workspaces.ts
 M packages/auth/src/workspaces.test.ts
 M packages/database/src/audit.test.ts
 M packages/database/src/tenant-db.test.ts
?? packages/database/src/test-db-guard.ts
?? docs/PHASE-2-SECURITY-S1-VERIFICATION-REPORT.md
```

Seluruh perubahan lokal sebelumnya tetap ada. Tidak ada commit/push/reset/
checkout/stash/clean.

---

## 4. Development/Production Database Isolation Evidence

| Item | Bukti |
|---|---|
| Server sistem 3306 | `ss` menunjukkan listener; **tidak ada perintah yang menghubungi 3306** |
| Dev DB 3307 | Tidak ada listener sebelum dan sesudah checkpoint |
| Instance verifikasi | Dibuat baru di `/tmp/s1-verify-20261119`, port 3317 |
| Datadir | `/tmp/s1-verify-20261119/data` (145 MB), terpisah dari `app/.devdb` |
| Socket/PID/log | `/tmp/s1-verify-20261119/run`, `/log` |
| Database | `absensi_s1_verify_20261119` — dibuat baru, sebelumnya 0 tabel |
| User | `s1_migrator` (DDL/DML pada DB itu), `s1_app` (grant per tabel) |
| `.env` proyek | Tidak dibaca isinya, tidak diubah |
| `.env.test` | Tidak ada |
| Precedence env | Diuji: `process.loadEnvFile()` **tidak** menimpa env eksplisit (`file_overrode_existing=false`) |

Keterbatasan jujur: tidak ada bukti kriptografis bahwa server 3306 tidak
berubah; buktinya adalah tidak ada koneksi/ perintah yang diarahkan ke sana
selama checkpoint. Semua perintah DB memakai socket `/tmp/...` atau TCP 3317.

---

## 5. Test Database Configuration and Identity

```
host      127.0.0.1
port      3317
database  absensi_s1_verify_20261119
users     s1_migrator@127.0.0.1 (migration/admin test)
          s1_app@127.0.0.1      (runtime, audit SELECT+INSERT)
```

Verifikasi identitas melalui `s1_app`:

```
db                              port  user
absensi_s1_verify_20261119      3317  s1_app@127.0.0.1
tables_count = 12
permissions_count = 27
```

Migration yang ada
(`prisma/migrations/20261118090000_m1_foundation/migration.sql`) diterapkan
**hanya** ke database ini melalui `s1_migrator` TCP 3317, exit 0. Tidak ada
perubahan file migration/schema.

Konfigurasi test disimpan di `/tmp/s1-verify-20261119/test.env` (mode `600`),
berisi URL dan kredensial test. Tidak ada nilai rahasia yang dicetak ke laporan.

---

## 6. Test Harness Safety Verification

Safety gate baru, fail-closed, di dua paket:

- `packages/auth/src/test-support.ts` → `assertIsolatedTestDatabase()`
  dipanggil oleh `adminClient()` dan `resetDatabase()`.
- `packages/database/src/test-db-guard.ts` → dipanggil di `before()` test
  `audit.test.ts` dan `tenant-db.test.ts`.

Kondisi yang wajib benar:

1. `S1_TEST_DB_GUARD=1`.
2. `S1_TEST_DB_NAME`, `S1_TEST_DB_HOST`, `S1_TEST_DB_PORT` eksplisit.
3. Nama database cocok `/^absensi_s1_verify_[a-z0-9]+$/`.
4. Protokol `mysql:`/`mariadb:`.
5. Host dan port **persis** sama dengan target yang disetujui.
6. Nama database persis sama (bukan hanya mengandung “test”).
7. Nama bukan `absensi`, `absensi_dev`, `absensi_prod`, `absensi_production`,
   `mysql`, `information_schema`, `performance_schema`, `sys`.
8. User diawali `s1_`.
9. Tidak ada parameter koneksi tambahan (socket/opsi lain).

Bukti negatif:

| Skenario | Hasil |
|---|---|
| URL dev `127.0.0.1:3307/absensi_dev` | ditolak: host/port tidak sesuai |
| Tanpa `S1_TEST_DB_GUARD=1` | ditolak: guard wajib |
| Tanpa env eksplisit | ditolak |

`resetDatabase()` tidak dapat dijalankan tanpa gate. Ini juga mengurangi
TD-2-R7 (harness destruktif tanpa guard URL).

Catatan: `node --test dist` ikut mengeksekusi artefak `dist/test-support.js` dan
`dist/test-db-guard.js` sebagai “test” (masing-masing 1 entri). Karena itu
hitungan runner 66/21 lebih besar 2 dari jumlah test kasus sebenarnya (64/19).

---

## 7. S1-D1 through S1-D6 Individual Results

Dijalankan dengan:

```
node --test --test-force-exit --test-concurrency=1 \
  --test-name-pattern='S1-D' dist/workspaces.test.js
```

### Run pertama (sebelum koreksi ekspektasi)

| Test | Hasil | Catatan |
|---|---|---|
| S1-D1 | PASS | Admin→owner ditolak; assignment target tetap VIEWER; owner tetap 1 |
| S1-D2 | **FAIL** | Test mengharapkan 403, implementasi mengembalikan **409 LAST_OWNER_PROTECTED** untuk target owner terakhir |
| S1-D3 | PASS | Admin→ANALYST tetap diizinkan |
| S1-D4 | PASS | Invitation owner/admin ditolak; viewer diterima |
| S1-D5 | PASS | Transfer sukses, tepat 1 owner, aktor jadi admin, audit tertulis |
| S1-D6 | PASS | Non-owner/self/nonaktif/owner lain ditolak |

**Analisis kegagalan S1-D2:** bukan celah keamanan. `evaluateRoleChange`
memeriksa `LAST_OWNER_PROTECTED` sebelum hierarki untuk target owner terakhir.
Aktor admin tetap **ditolak**; hanya kode status berbeda. Assertion diperbaiki
secara eksplisit: kasus peer/admin → 403 `ROLE_HIERARCHY_VIOLATION`; kasus owner
terakhir → 409 `LAST_OWNER_PROTECTED`. Tidak ada assertion yang dihapus atau
dilemahkan; kedua kasus tetap wajib ditolak.

### Run final

| Test | Hasil |
|---|---|
| S1-D1 | PASS |
| S1-D2 | PASS (setelah koreksi ekspektasi) |
| S1-D3 | PASS |
| S1-D4 | PASS |
| S1-D5 | PASS |
| S1-D6 | PASS |
| S1-D7 (baru, konkurensi) | PASS |
| S1-D8 (baru, batas tenant) | PASS |
| S1-D9 (baru, rollback) | PASS |

`9/9 PASS`, exit 0.

---

## 8. Complete DB Suite Results

| Suite | Perintah | Hasil |
|---|---|---|
| Auth (DB + DB-free) | `node --test --test-force-exit --test-concurrency=1 dist` | **66/66 PASS**, exit 0 |
| Database | `node --test --test-force-exit --test-concurrency=1 dist` | **21/21 PASS**, exit 0 |
| Web | `npm test --workspace @absensi/web` | **2/2 PASS**, exit 0 |
| Permissions | `npm test --workspace @absensi/permissions` | **9/9 PASS**, exit 0 |
| Typecheck | `npm run typecheck` | **exit 0** |

Suite auth mencakup B1–B14, C1–C5, D1–D7, E1–E2, F1–F5, H1–H6, L1–L5,
S1-1…S1-11, dan S1-D1…S1-D9. Test berjalan serial
(`--test-concurrency=1`), masing-masing file memakai `resetDatabase()` pada DB
terisolasi.

**Baseline sebelum perbaikan konkurensi:** auth 62/63 (hanya S1-D2 gagal),
database 21/21. Tidak ada test lain yang gagal.

Test lama tidak dihapus, di-skip, atau dilemahkan. Satu-satunya perubahan
assertion adalah koreksi S1-D2 yang dijelaskan di §7.

---

## 9. Concurrency Audit Methodology

Harness: `/tmp/s1-verify-20261119/concurrency.mjs` (di luar repo).

- Setiap iterasi membuat tenant baru + owner + dua target VIEWER.
- Dua `transferOwnership()` dipanggil dengan `Promise.allSettled` — benar-benar
  bersamaan, bukan sekuensial.
- Setiap panggilan dibatasi timeout 15 detik.
- Setelah selesai: jumlah owner, identitas owner, dan jumlah role aktor dicatat.
- Baseline: 8 iterasi. Setelah perbaikan: 8 lalu 20 iterasi.
- `resetDatabase()` dipanggil di awal; DB adalah DB terisolasi.
- Proses keluar eksplisit setelah `disconnectPrisma()` + `$disconnect()`.

Catatan baseline: perintah pertama timeout 300 detik karena handle `systemDb()`
(test-support) tidak ditutup, bukan karena transfer menggantung. Kedelapan
iterasi tetap selesai dan datanya tersimpan; ini yang mengungkap 5 workspace
dengan dua owner. Harness kemudian diperbaiki agar memutus semua koneksi dan
`process.exit(0)`.

Analisis tambahan: `SHOW ENGINE INNODB STATUS` menangkap deadlock nyata antara
dua transaksi yang meng-INSERT `member_roles` dan saling menunggu lock.

---

## 10. Concurrency Experiment Results

### Baseline — UNSAFE

8 iterasi, dua transfer bersamaan dari owner yang sama:

| Workspace | Jumlah owner |
|---|---|
| Race 0 | 1 |
| Race 1 | **2** |
| Race 2 | **2** |
| Race 3 | **2** |
| Race 4 | 1 |
| Race 5 | **2** |
| Race 6 | **2** |
| Race 7 | 1 |

**5/8 workspace berakhir dengan dua owner.** Invariant “tepat satu owner”
terbukti dapat dilanggar. InnoDB juga mencatat deadlock pada `member_roles`.

### Perbaikan 1 — lock baris owner

`SELECT member_id FROM member_roles … FOR UPDATE` + verifikasi ulang aktor.

- Owner count: **0/8 pelanggaran**.
- Tetapi **4/8** transaksi kedua gagal dengan `P2010` (raw query/transaction
  conflict) karena lock berada pada baris yang sedang dihapus/dipindah.

### Perbaikan final — lock baris workspace

`SELECT id FROM workspaces … FOR UPDATE` (baris stabil), lalu baca owner di
dalam transaksi dan pastikan aktor masih satu-satunya owner sebelum menulis.

- 20 iterasi: **0 double success, 0 bad owner count, 0 `P2010`**.
- Penolakan kedua selalu `409 OWNERSHIP_CHANGED`.
- Owner akhir selalu tepat satu (`a` atau `b`), aktor selalu menjadi admin
  (tepat satu role).

S1-D7 mengunci perilaku ini sebagai regression test: dua transfer bersamaan →
tepat satu owner, satu sukses, satu `OWNERSHIP_CHANGED`.

### Scenario B — dua role change bersamaan

**NOT VERIFIED secara eksperimen.** Analisis kode: PATCH role tidak dapat
memberikan `WORKSPACE_OWNER`, dan demosi owner terakhir ditolak
hierarki/last-owner. Tidak ada jalur PATCH yang mengubah owner. Dampak pada
invariant ownership: tidak ditemukan.

### Scenario C — kegagalan transaksi

S1-D9: transaksi yang menghapus role target, menambah owner, lalu melempar
error → seluruh perubahan rollback; target tetap VIEWER; owner tetap aktor.
**PASS.**

### Scenario D — kegagalan audit

Dengan `INSERT` pada `audit_logs` dicabut dari `s1_app` (test DB saja), transfer
tetap **berhasil**: `fulfilled=true`, owner tepat 1, target menjadi owner,
`auditRows=0`. Grant dikembalikan dan diverifikasi.

Implikasi: perubahan ownership dapat terjadi tanpa jejak audit bila writer
gagal. Ini konsisten dengan desain best-effort (TD-1-R14), tetapi untuk aksi
kepemilikan sebaiknya audit menjadi bagian dari transaksi/outbox. **Tidak
diubah di checkpoint ini** karena menyentuh infrastruktur audit.

---

## 11. Last-Owner Invariant Analysis

Lapisan perlindungan saat ini:

1. **Struktural:** tidak ada endpoint hapus member/owner.
2. **Hierarki:** tidak ada role di atas owner; admin tidak dapat mengubah owner;
   owner tidak dapat mengubah owner lain (rank setara) atau dirinya sendiri.
3. **Eksplisit:** `LAST_OWNER_PROTECTED` bila target owner dan `ownerCount <= 1`,
   dengan hitung ulang di dalam transaksi role change.
4. **Transfer:** transaksi mensyaratkan aktor masih satu-satunya owner setelah
   lock; jumlah owner setelah transfer harus **tepat 1**, jika tidak rollback.
5. **Konkurensi:** lock baris workspace menyerialkan transfer; penantang kedua
   menerima `OWNERSHIP_CHANGED`.

Hasil: **20/20 eksperimen konkurensi berakhir dengan tepat satu owner**; S1-D1,
D2, D6, D7, S1-8 semuanya lulus. Tidak ada invariant violation yang tersisa
yang dapat direproduksi.

Catatan: workspace lama yang sudah memiliki beberapa owner (dampak S-1) akan
ditolak saat transfer dengan `OWNERSHIP_CHANGED` karena `currentOwners.length
!== 1`. Pembersihan data lama tidak dilakukan (dilarang menghapus data).

---

## 12. Transaction Rollback Verification

- `transferOwnership()` melakukan seluruh perubahan role di dalam satu
  `db.$transaction`; lock, penghapusan role target, pemberian owner, demosi
  aktor, dan verifikasi jumlah owner berada di transaksi yang sama.
- S1-D9 menyuntikkan error setelah dua penulisan; hasil akhir: role target
  kembali VIEWER, owner tetap aktor. **PASS**.
- `changeMemberRole()` juga memakai transaksi untuk upsert/delete role; hitung
  ulang owner dilakukan sebelum penghapusan.
- Tidak ada penulisan parsial yang teramati pada skenario yang diuji.

---

## 13. Security Regression Matrix

| # | Kontrol | Bukti | Status |
|---|---|---|---|
| 1 | Admin tidak dapat assign owner | S1-D1 (DB), S1-2 (DB-free) | PASS |
| 2 | Owner tidak dapat assign owner via PATCH | S1-3 (DB-free) | PASS |
| 3 | Admin tidak dapat assign admin | S1-D2 (DB), S1-4 | PASS |
| 4 | Admin tidak dapat modify admin lain | S1-D2 (DB), S1-5 | PASS |
| 5 | Admin tidak dapat modify owner | S1-D2 (DB, 409 last-owner), S1-5 (ownerCount=2 → 403) | PASS |
| 6 | Invitation tidak dapat assign owner | S1-D4 (DB), S1-9 | PASS |
| 7 | Hanya owner dapat transfer | S1-D6 (DB), S1-10 | PASS |
| 8 | Transfer ke diri sendiri ditolak | S1-D6 (DB), S1-11 | PASS |
| 9 | Transfer ke member nonaktif ditolak | S1-D6 (DB), S1-11 | PASS |
| 10 | Transfer ke owner lain ditolak | S1-D6 (DB), S1-11 | PASS |
| 11 | Invariant last-owner dilindungi | S1-8, S1-D2, S1-D7, 20/20 concurrency | PASS |
| 12 | Batas tenant ditegakkan | S1-D8 (DB), D5/L4 | PASS |
| 13 | Transaksi gagal tidak meninggalkan partial | S1-D9 (DB) | PASS |
| 14 | Transfer sukses menulis audit | S1-D5 (DB) | PASS |
| 15 | Audit tanpa token/hash/password | S1-D5 + E1 | PASS |

Tidak ada item yang hanya diklaim berdasarkan keberadaan source code tanpa
menyebut jenis buktinya.

---

## 14. Audit Trail Verification

- `ownership.transfer` ditulis dengan `actorUserId`, `actorMemberId`,
  `resourceId` target, metadata `fromMemberId`, `toMemberId`, `fromRoleKey`,
  `toRoleKey`, `previousTargetRoleKeys`.
- `ip` di-hash 32 byte; tidak ada token/password/hash di metadata
  (S1-D5 memeriksa serialisasi JSON).
- `role.change` tetap menulis `from` (role id) dan `to` (role key).
- Audit writer memakai akun `s1_app`; grant `SELECT, INSERT` saja pada
  `audit_logs` diverifikasi oleh suite database (UPDATE/DELETE/DDL ditolak).
- **Keterbatasan:** bila INSERT audit gagal, transfer tetap commit dan audit
  hilang (diuji langsung). Tidak ada outbox/transaksi gabungan.

---

## 15. Remaining Technical Debt

| ID | Item | Status |
|---|---|---|
| TD-S1-R2 | Race ownership/last-owner | **CLOSED** — defect direproduksi, diperbaiki dengan workspace lock, 20/20 aman |
| TD-S1-R3 | Percobaan ditolak tidak diaudit | OPEN (non-kritis) |
| TD-S1-R4 | Rotasi/revocation sesi | Evaluated — tidak perlu selama permission dibaca per request |
| TD-S1-V1 | Audit ownership best-effort | OPEN — transfer bisa commit tanpa audit |
| TD-S1-V2 | Tidak ada test handler HTTP | OPEN |
| TD-S1-V3 | Concurrent PATCH role changes | NOT VERIFIED (tidak memengaruhi ownership) |
| TD-2A-R1 | 56 test DB NOT VERIFIED | **CLOSED untuk auth+database** — 66/21 PASS |
| TD-2-R7 | `resetDatabase()` tanpa guard | **PARTIALLY CLOSED** — guard URL fail-closed; guard duplikat di dua paket |
| TD-1-R14 | Audit best-effort | OPEN (sama dengan TD-S1-V1) |
| TD-S1-V4 | Data lama multi-owner | OPEN — tidak dibersihkan (dilarang menghapus data) |

---

## 16. Exact Commands Executed and Exit Codes

| Perintah (ringkas) | Exit | Hasil |
|---|---|---|
| `git rev-parse HEAD` / `branch` | 0 | `47e77c0…` / `main` |
| Probe `process.loadEnvFile` | 0 | `file_overrode_existing=false` |
| `mariadb-install-db --datadir=/tmp/s1-verify-20261119/data` | 0 | system tables dibuat |
| `/usr/sbin/mariadbd … --port=3317` | background | listener 3317 aktif |
| `CREATE DATABASE/USER` via socket | 0 | DB + 2 user test |
| `mariadb … < migration.sql` (TCP 3317) | 0 | 12 tabel, 27 permission |
| Guard: URL dev | 0 | ditolak (`host/port tidak sama`) |
| Guard: tanpa flag | 0 | ditolak (`S1_TEST_DB_GUARD=1 wajib`) |
| S1-D baseline | **1** | 5 pass, 1 fail (S1-D2 409 vs 403) |
| Full auth baseline | **1** | 62/63 (hanya S1-D2) |
| Full database baseline | 0 | 21/21 |
| Concurrency baseline (8) | timeout 300s | 8 iterasi selesai; **5/8 dua owner**; deadlock tercatat |
| S1-D setelah koreksi + fix | 0 | 7/7, lalu 9/9 |
| Concurrency owner-lock (8) | 0 | 0/8 dua owner; 4/8 `P2010` |
| Concurrency workspace-lock (20) | 0 | 0/20 dua owner; 0 `P2010` |
| Audit-failure experiment | 0 | transfer sukses, 1 owner, 0 audit |
| Full auth final | 0 | **66/66** |
| Full database final | 0 | **21/21** |
| Web / permissions / typecheck | 0 | 2/2, 9/9, exit 0 |
| Stop server (`kill`) | 0 | port 3317 closed, shutdown complete |

---

## 17. Files Created or Modified

### Repository

| File | Perubahan |
|---|---|
| `packages/auth/src/test-support.ts` | Guard DB terisolasi fail-closed di `adminClient()` dan `resetDatabase()` |
| `packages/auth/src/workspaces.ts` | Lock baris workspace + verifikasi owner tunggal + invariant tepat satu owner |
| `packages/auth/src/workspaces.test.ts` | Koreksi ekspektasi S1-D2; tambah S1-D7/D8/D9; cek metadata audit |
| `packages/database/src/test-db-guard.ts` | **Baru** — guard untuk test paket database |
| `packages/database/src/audit.test.ts` | Memanggil guard |
| `packages/database/src/tenant-db.test.ts` | Memanggil guard |
| `docs/PHASE-2-SECURITY-S1-VERIFICATION-REPORT.md` | **Baru** — laporan ini |

### Luar repository (sementara, dipertahankan)

```
/tmp/s1-verify-20261119/
├── data/                     datadir MariaDB (145 MB)
├── run/                      socket/pid (pidfile dihapus saat shutdown)
├── log/                      install.log, mysqld.log
├── test.env                  kredensial test (mode 600)
├── concurrency.mjs           harness konkurensi
├── concurrency-postfix.json  hasil 20 iterasi
├── audit-failure.mjs         harness audit gagal
├── audit-failure.out         output eksperimen
└── innodb-status.txt         bukti deadlock baseline
```

Tidak ada perubahan schema, migration, `.env`, dependency, atau Git history.

---

## 18. Database Cleanup / Lifecycle Status

- Server verifikasi dihentikan dengan `SIGTERM`; log mencatat
  `Shutdown complete`.
- Port 3317 **closed**; tidak ada proses `mariadbd` milik verifikasi.
- Database **tidak di-drop** dan datadir dipertahankan untuk review.
- Database development (3307) tetap mati dan tidak disentuh.
- Server sistem (3306) tidak dihubungi.
- Grant `s1_app` pada `audit_logs` dipulihkan setelah eksperimen audit failure.
- `test.env` berisi kredensial test dan harus dihapus setelah review selesai.
- Untuk menjalankan ulang: nyalakan `mariadbd` dengan datadir/socket/port yang
  sama, lalu `source test.env` dan jalankan test. Jangan arahkan ke 3307/3306.

---

## 19. Final Verdict

**PASS WITH LIMITATIONS.**

Alasan:

1. Database terisolasi terbukti dan test destruktif tidak dapat dijalankan
   tanpa guard.
2. S1-D1…S1-D9 lulus, termasuk regresi konkurensi, batas tenant, dan rollback.
3. Suite auth/database lengkap lulus pada DB terisolasi; tidak ada regresi.
4. **Defect kritis ditemukan dan diperbaiki:** baseline menghasilkan dua owner
   pada 5/8 percobaan; setelah lock baris workspace, 20/20 percobaan tepat satu
   owner tanpa deadlock/`P2010`.
5. Tidak ada invariant violation yang tersisa yang dapat direproduksi.

Status bukan PASS penuh karena:

- Audit ownership masih best-effort: transfer berhasil meski audit gagal.
- Belum ada test handler HTTP untuk endpoint transfer.
- Concurrent PATCH role changes tidak diuji langsung (dampak ownership tidak
  ditemukan secara analisis).
- Data lama multi-owner tidak dibersihkan.

---

## 20. Recommended Next Checkpoint

1. **Review laporan ini dan bukti di `/tmp/s1-verify-20261119`**, lalu putuskan
   apakah database test boleh di-drop dan `test.env` dihapus.
2. **Setujui commit** perubahan Unit 2A + S-1 + verifikasi ini (belum dilakukan).
3. **Unit keamanan audit ownership**: jadikan `ownership.transfer` atomik dengan
   audit (outbox atau transaksi yang sama) — perlu keputusan desain, bukan
   dilakukan sekarang.
4. **Tambahkan test handler HTTP** untuk transfer/role/invitation pada unit
   test berikutnya.
5. **Unit 2B hanya setelah persetujuan eksplisit.** Tidak ada Task 2.2/2.4/2.6/
   2.7 atau Phase 3 yang dimulai pada checkpoint ini.

**STOP.** Menunggu persetujuan pemilik proyek.
