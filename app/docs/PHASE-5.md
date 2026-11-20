# Phase 5 — Dashboard & Rekap

Status: **selesai untuk scope Phase 5 di lingkungan Linux/web admin**, dengan
batasan yang dicantumkan di bawah. Phase 2 tetap **parsial** karena email
production (TD-2-R1) belum ada.

## 1. Lingkup yang diselesaikan

### Migrasi m4 (additive)

- Model `WorkspaceHoliday` (`tenant_id`, `id`, `date`, `name`, `created_at`)
  dengan PK `(tenant_id, id)`, unique `(tenant_id, date)`, index
  `(tenant_id, date)`, dan FK cascade ke `workspaces`.
- Relasi `Workspace.holidays`.
- Index baru `attendance_logs`:
  `(tenant_id, work_date)`, `(tenant_id, member_id, work_date)`,
  `(tenant_id, type, work_date)`.
- `correction_requests_tenant_status_created_idx` sudah ada sejak migrasi m3;
  m4 tidak membuatnya ulang agar tetap additive.
- `WorkspaceHoliday` masuk `TENANT_MODELS` dan `resetDatabase`.
- Fixture test `seedHolidays` membuat tiga hari libur (25 Desember, 1 Januari,
  cuti bersama) hanya untuk suite test.
- Tidak ada kolom/tabel Phase 1–4 yang diubah selain penambahan index.

### Dashboard hari ini

- `GET /api/workspaces/:id/dashboard/today` (`attendance.read`).
- Respons: `date`, `totalMembers`, `checkedIn`, `late`, `absent`, `onSite`,
  `correctionsPending`, `holiday`, `members`, `pagination`.
- Keterlambatan dihitung dari `timestamp_server` pada timezone kantor aktif
  terhadap `work_start + LATE_TOLERANCE_MINUTES` (default 15).
- Absen dikecualikan bila tanggal ada di `workspace_holidays`; statusnya
  `HOLIDAY`.
- `onSite` = sudah check-in tanpa check-out.
- Halaman `/workspaces/:id/dashboard` menampilkan kartu ringkasan dan tabel
  member (nama, status, jam masuk/keluar, menit terlambat).

### Rekap bulanan

- `GET /api/workspaces/:id/reports/monthly?year=&month=&memberId=`
  (`attendance.read`).
- Per member: `days[]` berisi `date`, `checkIn`, `checkOut`, `workHours`,
  `late`, `status`; plus `totalWorkHours`, `totalLate`, `totalAbsent`.
- Jam kerja = check-out − check-in, dikurangi `BREAK_MINUTES` (default 60)
  hanya bila lebih dari 6 jam.
- Status: `PRESENT`, `INCOMPLETE`, `ANOMALY`, `ABSENT`, `HOLIDAY`, `WEEKEND`,
  `FUTURE`. Check-out lebih awal dari check-in → `ANOMALY`, `workHours = 0`
  (tidak pernah negatif).
- Hari libur dari tabel tidak dihitung alpha; akhir pekan dan tanggal setelah
  hari ini juga bukan alpha.
- Halaman `/workspaces/:id/reports` menampilkan ringkasan per member dan tabel
  per tanggal yang dapat di-expand (`<details>`).

### Export CSV

- `GET /api/workspaces/:id/reports/monthly/export?year=&month=&format=csv`.
- Header: `member_name,date,check_in,check_out,work_hours,late_minutes,status`.
- `Content-Type: text/csv; charset=utf-8`,
  `Content-Disposition: attachment; filename="rekap-YYYY-MM.csv"`.
- Hanya kolom tersebut; tanpa foto, koordinat, proof URL, email, atau hash.
- Audit `report.export` dengan `tenant_id`, actor user/member, `ip_hash`
  32 byte, metadata `{year, month, format, rowCount}`.

### Statistik keterlambatan

- `GET /api/workspaces/:id/reports/late-stats?year=&month=`.
- Respons: `totalLate`, `lateByDay`, `lateByMember`, `averageLateMinutes`.
- Halaman `/workspaces/:id/reports/late` memakai bar CSS tanpa dependency
  chart baru.

### Filter dan pagination

- Dashboard: `date`, `memberId`, `status`, `limit`, `offset`.
- Rekap: `year`, `month`, `memberId`, `from`, `to`, `status`, `limit`,
  `offset`; export menerima `from`/`to`/`memberId`.
- Batas `limit` 1–100; `offset >= 0`; `from <= to`. Pelanggaran → 400
  (`INVALID_PAGINATION`, `INVALID_DATE_RANGE`, `INVALID_STATUS`).
- Ringkasan dashboard tetap dihitung dari seluruh member; filter hanya
  menyaring baris yang dikembalikan.

### Navigasi dan layout

- Layout `/workspaces/:id` menambahkan sidebar: Dashboard, Members,
  Corrections, Reports, Audit, Settings.
- Menu hanya muncul jika permission dimiliki; breadcrumb dan tautan kembali
  konsisten, status aktif memakai `aria-current`.
- Tenant tetap diambil dari context session, bukan URL.

### Kelola hari libur

- `GET/POST /api/workspaces/:id/holidays`,
  `DELETE /api/workspaces/:id/holidays/:holidayId` (`workspace.manage`).
- Halaman `/workspaces/:id/settings/holidays` dengan form tanggal + nama dan
  tombol hapus.
- Audit `workspace.holiday_create` dan `workspace.holiday_delete` menyimpan
  `{date, name}`, actor, dan `ip_hash` 32 byte.
- Tanggal duplikat → 409 `HOLIDAY_EXISTS`; tanggal tidak valid → 400;
  hari libur tidak ada → 404.

## 2. Keputusan dan deviasi

- **Index koreksi tidak dibuat ulang**: `(tenant_id, status, created_at)` sudah
  dibuat pada m3. Membuatnya lagi akan menggagalkan migrasi additive.
- **GRANT tetap di `grants.sql`**: mengikuti pola Phase 1–4. Migration tidak
  memuat `GRANT` karena user database berbeda antara dev dan test; setup test
  memberi DML otomatis ke semua tabel kecuali `audit_logs`, yang tetap
  SELECT/INSERT.
- **Akhir pekan bukan alpha**: rekap menandai `WEEKEND` agar total alpha tidak
  membengkak. Ini keputusan produk yang tidak disebut eksplisit di spesifikasi.
- **Tanggal masa depan bukan alpha**: status `FUTURE`.
- **Rekap dengan filter status** menghitung ulang total dari hari yang
  ditampilkan, sehingga total konsisten dengan tabel yang terlihat.
- **CSV memakai timestamp ISO UTC** dan kode status mentah agar dapat diolah
  payroll; timezone kantor tetap dipakai untuk perhitungan terlambat.
- **Satu kantor aktif** dipakai untuk ambang keterlambatan (kantor pertama
  yang aktif), karena model belum memetakan member ke kantor.
- **Test UI web** tetap berupa assertion sumber statis seperti Phase 1–4,
  bukan browser E2E.
- **Dashboard `date`** dapat diisi untuk laporan tanggal tertentu; default
  hari ini UTC.
- **Dev DB**: `.env` lokal gagal autentikasi ke MariaDB dev, sehingga migrasi
  dijalankan dengan URL root lokal eksplisit. Semua migrasi m2–m4 berhasil
  diterapkan; tidak ada data Phase 1–4 yang dihapus.
- **Flutter tidak berubah** pada Phase 5; suite mobile tetap 34 test.

## 3. Bukti test

| Pemeriksaan | Hasil |
|---|---|
| `npx prisma validate` | exit 0, schema valid |
| `npx prisma migrate deploy` | exit 0; m2, m3, m4 diterapkan |
| `SHOW TABLES LIKE 'workspace_holidays'` | 1 baris |
| Index baru (`information_schema.statistics`) | 11 baris untuk 4 nama index (kolom composite) |
| Tenant isolation `WorkspaceHoliday` (T17) | lulus |
| `npm run build` | exit 0 |
| `npm run typecheck` | exit 0 |
| `npm run test:ci` | exit 0 |
| Auth suite | 104/104 pass |
| Database suite | 31/31 pass |
| Permissions suite | 9/9 pass |
| Web suite | 39/39 pass |
| Total backend | **183 pass, 0 fail** |
| `flutter analyze` / `flutter test` | tidak berubah: exit 0 / 34 pass |
| Clean-checkout setiap tag Phase 5 | dijalankan untuk 5a-migration … 5-closure |

Test HTTP baru:

- `C-DASH-1…3`: campuran tepat waktu/terlambat/absen/on-site, hari libur dari
  tabel, foreign vs missing 403 identik.
- `C-REP-1…2`: jam kerja 7.17 setelah istirahat, `INCOMPLETE`, `ANOMALY` dengan
  0 jam, `HOLIDAY`, `WEEKEND`, `FUTURE`, filter member, validasi bulan,
  cross-tenant.
- `C-CSV-1…2`: header tepat, 121 baris, tanpa email/URL/foto/proof, audit
  `report.export` tanpa data pribadi, format lain 400, cross-tenant 403.
- `C-LATE-1`: total, per hari, per member, rata-rata 15 menit, cross-tenant.
- `C-FILTER-1…2`: rentang tanggal, filter status, pagination `{limit, offset,
  total}`, limit 101 → 400, rentang terbalik → 400.
- `C-HOL-1…3`: create/list/duplicate/invalid, delete + audit, non-admin dan
  cross-tenant 403.

## 4. Cara menjalankan

```bash
cd /home/reksa/absen-solusi/app
npm ci
npm run prisma:generate
npm run build
npm run typecheck
# S1_TEST_SETUP_URL atau S1_TEST_ADMIN_URL harus dapat DDL database test
npm run test:ci
```

Migrasi dev:

```bash
cd packages/database
DATABASE_URL="mysql://<user>:<password>@127.0.0.1:3307/absensi_dev" npx prisma migrate deploy
```

Clean-checkout per tag:

```bash
cd /home/reksa/absen-solusi/app
bash scripts/ci-clean-checkout.sh \
  checkpoint-5a-migration checkpoint-5b checkpoint-5c checkpoint-5d \
  checkpoint-5e checkpoint-5f checkpoint-5g checkpoint-5h checkpoint-5-closure
```

Mobile tidak berubah pada Phase 5:

```bash
cd apps/mobile
flutter analyze && flutter test && flutter build apk --debug
```

Konfigurasi: `LATE_TOLERANCE_MINUTES=15`, `BREAK_MINUTES=60`.

## 5. Tech debt baru

| ID | Item | Alokasi |
|---|---|---|
| TD-5-R1 | Export CSV memuat seluruh bulan ke memori; belum streaming untuk workspace besar. | Report scaling |
| TD-5-R2 | Ambang terlambat memakai satu kantor aktif; belum ada pemetaan member→kantor/shift. | Multi-office |
| TD-5-R3 | `work_date` disimpan sebagai hari UTC; kasus lintas timezone ekstrem belum diuji. | Timezone hardening |
| TD-5-R4 | Test UI web statis; CRUD hari libur, filter, dan dialog belum diuji di browser. | E2E test |
| TD-5-R5 | API mendukung limit/offset, tetapi halaman rekap belum punya kontrol halaman. | UX laporan |
| TD-5-R6 | Export belum di-rate-limit dan audit `report.export` tidak menyimpan `resourceId`. | Observability/abuse |
| TD-5-R7 | Dashboard/rekap mengambil baris mentah lalu agregasi di aplikasi; belum SQL `groupBy` untuk workspace besar. | Performa |
| TD-5-R8 | Clean-checkout per tag masih dijalankan manual, belum diwajibkan oleh pipeline CI. | CI hardening |

## 6. Batasan yang tidak diklaim

- Phase 5 **tidak** menyelesaikan TD-2-R1 (email production), TD-2-R2 (CSP
  visual browser), atau TD-2-R3 (Redis production nyata).
- Tidak ada aplikasi mobile baru; Phase 5 hanya web admin + API.
- Belum ada penggajian penuh (potongan, tunjangan, slip gaji); CSV hanya
  menyediakan data dasar.
- Jam kerja belum menangani shift malam yang melewati tengah malam.
- APK debug tidak berubah dan bukan release yang ditandatangani.
