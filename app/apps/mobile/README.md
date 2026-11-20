# Absensi Mobile (Flutter)

Aplikasi Android/iOS untuk karyawan: login Bearer token, pilih workspace,
absensi GPS + foto real-time, dan riwayat absensi.

## Menjalankan

```bash
cd apps/mobile
flutter pub get
flutter analyze
flutter test
flutter run --dart-define=API_BASE_URL=http://10.0.2.2:3000
```

`API_BASE_URL` berasal dari `String.fromEnvironment`. Default
`http://10.0.2.2:3000` adalah loopback emulator Android ke host. Untuk perangkat
fisik gunakan IP host yang dapat dijangkau, dan untuk production gunakan HTTPS.

Backend harus berjalan dengan database yang sudah dimigrasikan. Mobile memakai:

- `POST /api/auth/login` dengan header `X-Auth-Mode: bearer`
- `GET /api/auth/me`
- `POST /api/auth/active-workspace`
- `POST /api/auth/logout`
- `GET /api/attendance/office`
- `POST /api/attendance/check-in`
- `POST /api/attendance/check-out` (multipart foto)
- `GET /api/attendance/me`

Token disimpan di `flutter_secure_storage`, bukan SharedPreferences. Tidak ada
cookie browser pada mobile.

## GPS, mock location, dan kamera

- `geolocator` mengambil latitude/longitude/accuracy dan meminta izin lokasi.
  Tombol absensi nonaktif bila accuracy di atas 100 m.
- Deteksi mock location memakai flag `Position.isMocked` dari `geolocator`.
  Flag ini hanya sinyal client; server tetap menolak `is_mock_location=true`
  dan menghitung anomali (akurasi terlalu sempurna, kecepatan tidak wajar,
  koordinat identik). Pendekatan ini dipilih agar tidak menambah plugin native
  yang tidak terawat dan tetap memiliki kontrol otoritatif di server.
- `camera` membuka kamera langsung dan mengambil foto baru; tidak ada akses
  galeri. Hasil foto dikirim sebagai multipart field `photo` (JPEG).
- Peta geofence adalah visualisasi skematik (CustomPainter), bukan tile map.
  Server tetap satu-satunya penentu Haversine/radius.

## Build Android

Prasyarat: Flutter 3.50+, Android SDK 35/36, Java 21, dan lisensi SDK diterima.

```bash
flutter doctor --android-licenses
flutter build apk --debug
```

APK debug dihasilkan di `build/app/outputs/flutter-apk/app-debug.apk`.
Izin Android yang dideklarasikan: INTERNET, CAMERA, ACCESS_FINE_LOCATION,
ACCESS_COARSE_LOCATION. iOS memakai `NSCameraUsageDescription` dan
`NSLocationWhenInUseUsageDescription`.

## CI mobile

Dari root repo:

```bash
bash scripts/mobile-ci.sh
```

Skrip menjalankan `pub get`, `analyze`, `test`, dan `build apk --debug`.
`scripts/ci-clean-checkout.sh` memanggil skrip ini untuk checkout yang memiliki
`apps/mobile/pubspec.yaml`.

## Batasan

- Belum ada offline queue; absensi memerlukan koneksi saat submit.
- Belum ada build iOS di CI Linux; konfigurasi Info.plist disiapkan.
- Peta hanya visual geofence, bukan peta jalan.
