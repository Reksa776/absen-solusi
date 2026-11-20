# Phase 3 — Attendance API + Flutter Mobile

Status: **selesai untuk scope Phase 3 di lingkungan Linux/Android debug**, dengan
batasan yang dicantumkan di bawah. Phase 2 tetap **parsial** karena email
production (TD-2-R1) belum ada.

## 1. Lingkup yang diselesaikan

### Backend

- Model `OfficeLocation` dan `AttendanceLog`, migration additive
  `20261119090000_m2_attendance`, grant DML per tabel; `audit_logs` tetap
  SELECT/INSERT.
- Permission `attendance.read`; katalog menjadi 28 permission.
- Haversine **di server**, bukan di client.
- Endpoint:
  - `POST /api/attendance/check-in` (multipart)
  - `POST /api/attendance/check-out` (multipart)
  - `GET /api/attendance/me?from=&to=`
  - `GET /api/attendance/office`
  - `GET /api/workspaces/:id/attendance?date=&memberId=`
- Validasi: kantor aktif, radius, accuracy ≤ 100 m, mock-location flag, dan
  timestamp server. Check-in/check-out ganda menghasilkan 409.
- Foto disimpan di filesystem (`ATTENDANCE_PHOTO_DIR`, default
  `public/uploads/attendance`), DB hanya menyimpan URL dan SHA-256. Tidak ada
  base64 di DB.
- Audit `attendance.check_in` / `attendance.check_out`: `tenant_id` non-null,
  actor user/member, `ip_hash` 32 byte, metadata hanya
  `{distance_meters, accuracy_meters, office_id, suspicious_reasons}`.
  Koordinat mentah, URL foto, dan hash foto tidak masuk metadata.
- Heuristik `is_suspicious`: accuracy < 1 m, kecepatan > 200 km/jam, dan
  koordinat identik berulang. Flag mock-location true tetap ditolak 403.
- Semua pembacaan/penulisan data tenant memakai `withTenant`; `systemDb` tetap
  dipakai hanya untuk session/membership platform-level.

### Flutter (`apps/mobile`)

- Dibuat dengan `flutter create --org com.absensi --project-name
  absensi_mobile --platforms=android,ios`.
- Struktur `lib/{api,core,models,screens,services,widgets}` dan `test/`.
- `flutter_secure_storage` untuk Bearer token (bukan SharedPreferences).
- API client: login `X-Auth-Mode: bearer`, me, switch workspace, logout,
  office aktif, check-in/out multipart, riwayat.
- Login → workspace picker → home absensi; logout mencabut sesi dan menghapus
  token.
- Home absensi: status hari ini, tombol besar check-in/check-out, geofence
  skematik CustomPainter, accuracy, peringatan mock/geofence, kamera real-time
  (`camera`), dan pesan error server.
- Riwayat: list, filter rentang tanggal, thumbnail, status dalam
  radius/suspicious, empty/error/retry.

## 2. Keputusan dan deviasi

- **Test DB setup**: opsi (a). Setup tidak pernah `DROP USER`. User dibuat bila
  belum ada dan password dirotasi dengan `ALTER USER`. Mode
  `S1_TEST_REUSE_USERS=1` memakai user test yang sudah ada untuk lingkungan
  tanpa DDL user. URL setup dipisahkan dari `DATABASE_URL` runtime melalui
  `S1_TEST_SETUP_URL`, sehingga sourcing `.env.test` tidak lagi membuat setup
  login sebagai user aplikasi.
- **Check-out** mengembalikan `200`, check-in `201`.
- **Endpoint office** ditambahkan karena mobile membutuhkan koordinat/radius
  kantor; tanpa endpoint ini peta geofence tidak bisa dirender.
- **Peta** adalah visual skematik geofence, bukan tile map. Server tetap
  otoritatif.
- **Mock location** memakai `Position.isMocked` dari `geolocator`; tidak ada
  plugin native tambahan. Flag client bukan satu-satunya kontrol—server menolak
  flag true dan tetap menghitung anomali.
- **Batas commit Flutter**: karena UI dikembangkan dalam satu rangkaian,
  seluruh `lib/` masuk commit `checkpoint-3c`; commit `3d`–`3f` menambahkan test
  per langkah. Ini deviasi dari pemisahan file per langkah, tetapi setiap tag
  tetap buildable. Tidak ada perubahan fungsional yang disembunyikan.
- **Kredensial test lokal**: `.env` pada mesin ini memakai
  `S1_TEST_SETUP_URL=mysql://root@127.0.0.1:3307/` (gitignored, bukan bagian
  commit). CI memerlukan `S1_TEST_SETUP_URL` atau `S1_TEST_ADMIN_URL` yang
  diizinkan DDL database test.

## 3. Bukti test

Dijalankan di worktree dengan database test terisolasi:

| Pemeriksaan | Hasil |
|---|---|
| `npm run test:ci` | exit 0 |
| Auth suite | 104/104 pass |
| Database suite | 29/29 pass |
| Permissions suite | 9/9 pass |
| Web suite | 9/9 pass |
| Total backend | **151 pass, 0 fail** |
| `flutter analyze` | exit 0 |
| `flutter test` | **25 pass, 0 fail** |
| `flutter build apk --debug` | exit 0; `app-debug.apk` ~166 MB |
| Smoke setup DB terbatas | `setup_smoke_pass ... user_ddl=denied`, 15 tabel |
| Clean-checkout `checkpoint-3g` | `RESULT checkpoint-3g PASS`, `MOBILE_CI=pass` |

Test HTTP nyata menyalakan `next start` dan memverifikasi:
check-in 201, check-out 200, geofence 403, accuracy 400, mock 403, duplikat 409,
riwayat sendiri, admin foreign/missing 403 identik, audit dengan `ip_hash` 32
byte, metadata tanpa koordinat/foto, dan foto filesystem + SHA-256.

Test service menambahkan verifikasi kecepatan tidak wajar dan koordinat
identik → `is_suspicious=true`, accuracy normal → false.

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

`flutter doctor --android-licenses` diperlukan pada mesin baru. Android SDK
35/36 dan Java 21 dipakai pada verifikasi ini.

## 5. Tech debt baru

| ID | Item | Alokasi |
|---|---|---|
| TD-3-R1 | Foto masih filesystem lokal; belum object storage, lifecycle, atau retensi. | Phase 4 / storage hardening |
| TD-3-R2 | Build iOS dan izin kamera/lokasi iOS belum dijalankan (CI Linux). | Sebelum rilis iOS |
| TD-3-R3 | Deteksi mock mengandalkan flag client + heuristik; belum Play Integrity/DeviceCheck. | Phase 4 security |
| TD-3-R4 | Peta geofence hanya visual skematik, belum tile map. | UX lanjutan |
| TD-3-R5 | Belum ada offline queue/retry absensi. | Bila dibutuhkan lapangan |
| TD-3-R6 | Clean-checkout penuh baru dijalankan untuk `checkpoint-3g`; `3b-env`, `3b`, dan `3c`–`3f` belum dibangun ulang satu per satu. Tag Flutter berbagi `lib/` yang sama, tetapi ini tetap verifikasi yang belum lengkap. | CI hardening |
| TD-3-R7 | Revisi absensi (pengajuan/approve/reject) belum termasuk B1–B9 Phase 3. | Phase 4 |

## 6. Batasan yang tidak diklaim

- Phase 3 **tidak** menyelesaikan TD-2-R1 (email production), TD-2-R2 (CSP
  visual browser), atau TD-2-R3 (Redis production nyata).
- APK yang diverifikasi adalah **debug**, bukan release yang ditandatangani.
- iOS belum dibangun di lingkungan ini.
- Foto production belum menggunakan S3/object storage.
- Smoke Redis nyata tidak tersedia; suite memakai `S1_RATE_LIMITER=memory`.
