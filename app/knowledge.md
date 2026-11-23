# Project Engineering & Anti-AI Slop Design System (Web, Android & iOS)

## 1. Anti-AI Slop Core Rules (Impeccable + vibeprompts.dev Standard)
- **Zero AI Visual Clichés:**
  - STRICTLY FORBIDDEN: purple/cyan decorative gradients, neon glows, heavy drop shadows (`shadow-lg`, `elevation: 8`), glassmorphism (`backdrop-blur`), oversized pastel icon circles inside KPI cards, generic hero banners, and decorative emojis in production UI.
  - Use Swiss-grid editorial discipline: generous whitespace, crisp `1px solid #E2E8E4` hairline borders, flat surfaces, and clear typographic hierarchy.
- **Locked Daylight Color System (Putih · Hijau · Kuning):**
  - **Canvas:** `#F7F9F8` (off-white daylight background)
  - **Surface / Card:** `#FFFFFF` with `1px solid #E2E8E4` border and `12px–14px` radius (`10px` for buttons/inputs).
  - **Primary / Approved / Present (Forest Green):** `#15803D` (hover `#166534`), soft badge fill `#DCFCE7` with `#14532D` text.
  - **Shift / Pending / Warning (Turmeric Yellow):** `#EAB308` / `#F59E0B`, soft badge fill `#FEF9C3` with `#422006` high-contrast text.
  - **Critical / Rejected / Absent:** `#DC2626` on `#FEE2E2` tint.
- **Typography & Tabular Precision:**
  - Every numeric value (clock timers, check-in/out times, GPS distance, shift schedules, leave quotas, overtime hours, and payroll numbers) MUST use `tabular-nums` (Web) and `FontFeature.tabularFigures()` (Flutter Android & iOS) so digits never jitter.

## 2. Cross-Platform Implementation Rules (Web, Android & iOS)
- **Web Admin (`apps/web` - Next.js 16 + Tailwind CSS):**
  - Clean fixed left sidebar (`#FFFFFF`, `1px` right border `#E2E8E4`), active navigation highlighted with `#DCFCE7` pill and `#EAB308` left indicator bar.
  - Data tables use `#F1F5F2` subtle headers, explicit status pills, clean pagination/filters, and zero cramped multi-button clutter.
  - Keep `apps/web/server.mjs` (`busboy` streaming) intact for APK uploads >10MB.
- **Mobile (`apps/mobile` - Flutter Android & iOS):**
  - Maintain the 4-tab bottom navigation shell (`Absen`, `Riwayat`, `Pengajuan`, `Profil`) on a flat `#FFFFFF` bar with `1px` top border `#E2E8E4`.
  - Keep iOS (`ios/Runner/Info.plist`) and Android (`AndroidManifest.xml`, `proguard-rules.pro`) permissions, ML Kit face detection, GPS geofencing, and local notifications synchronized across every feature update.
  - Keep circular front-camera selfie preview locked to portrait aspect ratio (`1 / aspectRatio`) with `BoxFit.cover` and natural horizontal mirror on captured preview only.

## 3. Target HRIS Feature Architecture (Kerjoo-Parity)
Implement all upcoming modules cleanly on top of the existing single-company Prisma/MariaDB schema and RBAC system:
1. **Kelola Karyawan & Pola Kerja:** Divisi, Jabatan, Lokasi Kehadiran (Geofence), Data Karyawan, Pola Kerja & Hari Kerja, Jadwal Shift, Surat Peringatan (SP).
2. **Kehadiran & Keamanan:** Kehadiran Harian, Ringkasan Kehadiran, Review Kehadiran Luar Kota, Revisi Kehadiran, Persetujuan Presensi, Persetujuan Perangkat (Device Binding), Persetujuan Foto Profil, Rekap Catatan Presensi, Pengaturan Kehadiran.
3. **Lembur, Izin & Cuti:** Lembur (Review, Jadwal, Pengaturan), Izin Kerja (Pengajuan & Review), Cuti (Permohonan, Laporan/Kuota, Pengaturan).
4. **Kunjungan Client, Pekerjaan & Broadcast:** Kunjungan Client (Jadwal, Virtualisasi, Ringkasan, AI Insight, Master Client, Pengaturan), Proyeksi Pekerjaan, Broadcast Pengumuman.
5. **Gaji (Payroll) & Pengaturan Global:** Hitung Gaji, Pembayaran, Laporan, Pengaturan Gaji, Perusahaan, Pengaturan Mobile, Alur Persetujuan (Multi-level Approval), Kalender Libur, Akun Admin, Panduan.

## 4. Verification Discipline
- Always run typecheck, unit/integration tests (`npm test` / `flutter test`), and build checks before finishing any task.
