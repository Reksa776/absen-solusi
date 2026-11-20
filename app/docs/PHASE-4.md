# Phase 4 — Revisi Kehadiran (Attendance Correction)

Status: **selesai untuk scope Phase 4 di lingkungan Linux/Android debug**,
dengan batasan yang dicantumkan di bawah. Phase 2 tetap **parsial** karena email
production (TD-2-R1) belum ada.

## 1. Lingkup yang diselesaikan

### Skema dan izin

- Model `CorrectionRequest` + kolom `attendance_logs.is_correction`, migration
  additive `20261120090000_m3_corrections`. Tidak ada tabel Phase 1–3 yang
  diubah selain kolom additive tersebut.
- Composite FK: `(tenant_id, member_id)` cascade, `(tenant_id,
  attendance_log_id)` restrict, `(tenant_id, reviewed_by_member_id)` restrict.
  Index `(tenant_id, member_id, status)` dan `(tenant_id, status, created_at)`.
- Grant DML `correction_requests` untuk user aplikasi dan host test;
  `audit_logs` tetap **SELECT/INSERT**.
- `CorrectionRequest` masuk `TENANT_MODELS` dan `resetDatabase`.
- Permission baru: `correction.read` (OWNER, ADMIN, ANALYST) dan
  `correction.review` (OWNER, ADMIN). Katalog menjadi **30 permission**.

### API

- `POST /api/corrections` — karyawan mengajukan revisi. JSON bila tanpa bukti,
  multipart bila ada bukti. Bukti base64 di JSON ditolak `INVALID_PROOF`.
- `GET /api/corrections/me?status=&from=&to=` — hanya baris milik sendiri.
- `GET /api/workspaces/:id/corrections?status=&memberId=&from=&to=&limit=&offset=`
  — antrian admin, `correction.read`, tenant dari context.
- `PATCH /api/corrections/:id` — `{action: "approve" | "reject",
  rejectionReason?}`, `correction.review`.
- Validasi pengajuan:
  - window `REVISION_WINDOW_DAYS` (default 7) dihitung dari jarak hari kalender
    UTC;
  - batas `REVISION_MONTHLY_LIMIT` (default 3) per member per bulan UTC,
    pelanggaran → `429` + `Retry-After`;
  - timestamp masa depan → `400 FUTURE_TIMESTAMP`;
  - `attendanceLogId` harus milik member dan tenant yang sama → `403`;
  - alasan wajib, 10–1000 karakter.
- Approve dalam satu transaksi: update `correction_requests`, update
  `attendance_logs` (timestamp + workDate) atau buat log baru
  `is_correction=true` bila tidak ada log, lalu audit
  `correction.approve` dengan metadata `{from, to, attendanceLogId}`.
- Reject: alasan wajib minimal 10 karakter, disimpan di
  `rejection_reason`; audit `correction.reject` hanya
  `{reason_length, hasReason}`.
- Approve/reject hanya untuk `PENDING`; selain itu `409 ALREADY_REVIEWED`.
  Revisi tenant asing dan revisi tidak ada sama-sama `403
  CORRECTION_FORBIDDEN`.
- Bukti disimpan di filesystem (`ATTENDANCE_PROOF_DIR`, default
  `public/uploads/proofs`); DB hanya URL + SHA-256, tidak ada base64.

### Flutter (`apps/mobile`)

- Screen **Ajukan Revisi**: date picker, pilihan check-in/check-out, alasan
  minimal 10 karakter dengan validasi sebelum submit, bukti opsional dari
  kamera, dan pesan error `WINDOW_EXCEEDED`, `FUTURE_TIMESTAMP`,
  `REVISION_LIMIT_EXCEEDED`, `ALASAN_TOO_SHORT`.
- Screen **Riwayat Revisi**: list dari `/api/corrections/me`, filter status,
  label status, alasan penolakan, tanggal pengajuan dan tanggal diminta,
  empty/error/retry.
- API client: `submitCorrection` (JSON atau multipart) dan `myCorrections`.

### Web admin

- `/workspaces/:id/corrections`: antrian dengan filter status (default
  `PENDING`), kolom member, tipe, tanggal, alasan, bukti, status, tombol
  Approve/Reject. Dialog approve berisi konfirmasi `from → to`; dialog reject
  memvalidasi alasan minimal 10 karakter. Error server tampil inline.
- `/workspaces/:id/corrections/:correctionId`: perbandingan original vs
  requested, bukti gambar/PDF, dan audit terkait read-only. Revisi tidak ada →
  404; workspace asing → redirect 403.
- Semua halaman memakai `requirePagePermission()`; tenant diambil dari context
  cookie, bukan URL.

## 2. Keputusan dan deviasi

- **Kolom `is_correction`**: approve tanpa `attendance_log_id` memerlukan cara
  membedakan log hasil koreksi dari absensi biasa. Ditambahkan sebagai kolom
  additive, bukan tabel baru.
- **Status/tipe sebagai varchar**: mengikuti pola Phase 1–3 yang tidak memakai
  Prisma enum.
- **Log koreksi baru** memakai koordinat kantor aktif (atau `0,0`), accuracy 0,
  distance 0, `photo_url`/`photo_hash` kosong. Foto asli tidak tersedia untuk
  revisi, jadi tidak ada foto palsu yang dikarang.
- **Approve log lama** hanya mengubah `timestamp_server` dan `work_date`; field
  lain dipertahankan.
- **Window** memakai jarak hari kalender UTC agar tidak bergantung timezone
  device; `requestedTimestamp` tetap instant absolut.
- **`correction.read`/`correction.review`** dipilih sebagai permission khusus
  alih-alih memakai `attendance.read`/`workspace.manage` agar ANALYST dapat
  membaca antrian tanpa dapat menyetujui.
- **Deviasi test UI web**: suite web memakai assertion sumber statis seperti
  pola Phase 1–3, bukan DOM/e2e. Endpoint dan validasi tetap diuji lewat test
  HTTP nyata.
- **Flutter hanya kamera** untuk bukti; tidak menambah dependency file picker.
- **Review service** membuat log untuk `correction.memberId`, bukan member
  reviewer. Ini bug yang ditemukan dan diperbaiki sebelum `checkpoint-4d`.
- **Commit Flutter**: `checkpoint-4e` memuat form + screen riwayat (karena form
  menautkan riwayat), `checkpoint-4f` menambahkan test riwayat. Setiap tag tetap
  buildable dan tidak ada perubahan fungsional yang disembunyikan.
- **Port test HTTP**: clean-checkout pertama gagal karena port acak test sempat
  memilih 3307, port MariaDB dev. Range dipindah ke 3400–3799 dan clean-checkout
  diulang sampai lulus. Kegagalan ini dilaporkan apa adanya, bukan diabaikan.

## 3. Bukti test

| Pemeriksaan | Hasil |
|---|---|
| `npm run build` | exit 0 |
| `npm run typecheck` | exit 0 |
| `npm run test:ci` | exit 0 |
| Auth suite | 104/104 pass |
| Database suite | 30/30 pass |
| Permissions suite | 9/9 pass |
| Web suite | 21/21 pass |
| Total backend | **164 pass, 0 fail** |
| `flutter analyze` | exit 0 |
| `flutter test` | **34 pass, 0 fail** |
| `flutter build apk --debug` | exit 0 (dijalankan untuk tag 4e dan 4f) |
| Clean-checkout `checkpoint-4-closure` | `RESULT checkpoint-4-closure PASS`, `MOBILE_CI=pass`, `CI_CLEAN_CHECKOUT=pass tags=1` |

Test HTTP nyata (`apps/web/test/corrections-http.test.mjs`) memverifikasi:

- C-HTTP-1 pengajuan + bukti → 201 PENDING, file + SHA-256, audit tanpa isi
  alasan/URL/hash;
- C-HTTP-2 window 7 hari, timestamp masa depan, alasan pendek → 400;
- C-HTTP-3 `attendanceLogId` milik member lain → 403;
- C-HTTP-4 pengajuan keempat dalam sebulan → 429 + `Retry-After`;
- C-HTTP-5 `/me` hanya baris sendiri + filter status;
- C-HTTP-6 antrian admin tenant-scoped, filter, foreign/missing 403 identik;
- C-HTTP-7 approve log lama → timestamp berubah + audit `{from, to}`;
- C-HTTP-8 approve tanpa log → log baru milik karyawan + `is_correction=true`
  + 409 saat diproses ulang;
- C-HTTP-9 reject wajib alasan, alasan tersimpan, audit hanya
  `{reason_length, hasReason}`;
- C-HTTP-10 review non-admin 403 dan cross-tenant 403 identik.

## 4. Cara menjalankan

Backend:

```bash
cd /home/reksa/absen-solusi/app
npm ci
npm run build
npm run typecheck
# S1_TEST_SETUP_URL atau S1_TEST_ADMIN_URL harus dapat DDL database test
npm run test:ci
```

Mobile:

```bash
cd apps/mobile
flutter pub get
flutter analyze
flutter test
flutter build apk --debug
flutter run --dart-define=API_BASE_URL=http://10.0.2.2:3000
```

Konfigurasi opsional backend: `REVISION_WINDOW_DAYS=7`,
`REVISION_MONTHLY_LIMIT=3`, `ATTENDANCE_PROOF_DIR=public/uploads/proofs`.

## 5. Tech debt baru

| ID | Item | Alokasi |
|---|---|---|
| TD-4-R1 | Bukti revisi masih filesystem lokal tanpa lifecycle/retensi/object storage. | Storage hardening |
| TD-4-R2 | Batas 3 pengajuan/bulan dihitung lalu dibuat tanpa lock; pengajuan bersamaan dapat melewati batas. | Concurrency hardening |
| TD-4-R3 | Approve dengan `attendance_log_id` yang barisnya sudah hilang membuat log baru tanpa peringatan ke admin. | Observability |
| TD-4-R4 | Test UI web berupa assertion sumber statis; alur dialog approve/reject belum diuji di browser. | E2E test |
| TD-4-R5 | Flutter hanya mendukung bukti dari kamera (belum file picker) dan belum memeriksa ukuran 5 MB sebelum upload. | UX mobile |
| TD-4-R6 | Clean-checkout penuh dijalankan untuk `checkpoint-4-closure`; tag 4a–4h tidak dibangun ulang satu per satu. | CI hardening |
| TD-4-R7 | Filter audit `resourceId` hanya divalidasi panjang dan belum ada index `(tenant_id, resource_id)`. | Performa audit |
| TD-4-R8 | File bukti disajikan dari path publik `/uploads/proofs` tanpa otorisasi per tenant. | Keamanan file |

## 6. Batasan yang tidak diklaim

- Phase 4 **tidak** menyelesaikan TD-2-R1 (email production), TD-2-R2 (CSP
  visual browser), atau TD-2-R3 (Redis production nyata).
- APK yang diverifikasi adalah **debug**, bukan release yang ditandatangani.
- iOS belum dibangun di lingkungan ini.
- Bukti production belum menggunakan S3/object storage dan belum memiliki
  kontrol akses file per tenant.
