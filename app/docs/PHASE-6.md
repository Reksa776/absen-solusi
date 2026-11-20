# Phase 6 — Hardening & Notifikasi

Status: **selesai untuk scope yang dapat diverifikasi di lingkungan ini**, dengan
batasan yang dinyatakan di §7. Phase 2 tetap **parsial** hanya untuk email
production yang sebelumnya terbuka (TD-2-R1); Phase 6 menutupnya di kode dan
test, tetapi belum mengirim email ke provider nyata dari lingkungan ini.

## 1. Lingkup yang diselesaikan

### Langkah 1 — Email production (TD-2-R1)

- `packages/auth/src/email.ts` menambah `SmtpEmailTransport` (Nodemailer) dan
  `ProviderEmailTransport` (Resend/SendGrid lewat HTTP), dengan interface
  `EmailTransport` yang tetap dipakai pemanggil.
- Konfigurasi: `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`,
  `SMTP_PASSWORD`, `FROM_EMAIL`, atau `EMAIL_PROVIDER` + `EMAIL_API_KEY`.
- **Fail-closed**: production tanpa SMTP/provider lengkap menghasilkan
  `UnavailableEmailTransport` yang melempar; tidak ada fallback diam-diam ke
  console. Dev tetap memakai `ConsoleEmailTransport` sebagai default.
- Template `packages/auth/src/email-templates.ts`: undangan, hasil revisi
  (approve/reject, alasan penolakan hanya saat reject), dan keterlambatan.
  HTML + plain text, data minimal, tanpa token di log.
- Notifikasi hasil revisi dikirim best-effort setelah transaksi review commit
  (`notifyCorrectionReviewed`); kegagalan dicatat tanpa membatalkan review.
  Undangan tetap non-blocking seperti Phase 2.
- Test `email-transport.test.ts` (10 test) memakai `smtp-server` in-process dan
  HTTP server lokal: link undangan benar, template, provider auth header,
  fail-closed production, dan tidak ada token/alasan di log.

### Langkah 2 — Push notification (TD-6 baru)

- Tabel `device_tokens` (migration additive `20261122090000_m5_push`), composite
  FK `(tenant_id, member_id)`, unik `(tenant_id, token)`, masuk `TENANT_MODELS`
  dan `resetDatabase`.
- `POST /api/notifications/register-device` (Bearer atau cookie session,
  permission `workspace.read`) menyimpan token per member + platform.
- `packages/auth/src/push.ts`: `PushTransport`, `MemoryPushTransport`,
  `FcmPushTransport` (HTTP v1, satu `message:send` per token), dan
  `UnavailablePushTransport` untuk production tanpa kredensial.
- Trigger: hasil revisi approve/reject, reminder check-in dan check-out harian
  (`sendAttendanceRemindersForDate`, melewati member yang sudah absen pada
  tanggal itu). Undangan diterima bersifat opsional dan belum dipicu.
- Flutter: `push_service.dart` (abstraksi `PushService`, `Noop`, `Memory`),
  `PushRegistrar` yang mendaftarkan token ke backend, dan
  `PushNotificationListener` untuk notifikasi foreground. `HomeScreen`
  mendaftarkan token saat dibuka.
- Test: P1–P5 (backend, termasuk isolasi tenant dan reminder), P-HTTP-1…3,
  Flutter `push_notification_test.dart` (3 test).

### Langkah 3 — Security hardening

- **CSP visual browser (TD-2-R2)**: Playwright (`apps/web/e2e`) berjalan di
  HTTPS lokal dengan sertifikat self-signed agar cookie `__Host-`/Secure diuji
  seperti production. 4 test: sign-in nonce + hidrasi, form sign-in membuat
  sesi cookie, dashboard, dan antrian revisi; tidak ada pelanggaran CSP di
  console.
- **Redis nyata (TD-2-R3)**: Redis 8.0.2 dijalankan lokal; `redis-real.test.ts`
  membuktikan dua instance `RedisRateLimiter` berbagi counter yang sama dan
  Redis mati membuat login 503 (fail-closed). Test di-skip otomatis bila
  `REDIS_REAL_URL` tidak diset, sehingga `npm run test:ci` tetap deterministik.
- **Rate limit register (TD-2-R5)**: bucket `register:ip:*` (5 per jam),
  fail-closed 503. `RL-HTTP-1` membuktikan percobaan keenam → 429 +
  `Retry-After`.
- **Bukti revisi (TD-4-R8)**: file tidak lagi disimpan di `public/`. Default
  `ATTENDANCE_PROOF_DIR` menjadi `storage/proofs` dan penyajian hanya lewat
  `GET /api/corrections/:id/proof` yang memvalidasi tenant + kepemilikan atau
  permission review. Nama file divalidasi pola UUID+ekstensi (anti traversal).
  Tenant asing → 403; revisi tanpa bukti/tidak ada → 404.
- **Index audit (TD-4-R7)**: migration `20261123090000_m6_audit_index` menambah
  `(tenant_id, resource_id)`; test `S-1` memeriksa `information_schema`.

### Langkah 4 — Observability

- Audit `report.export` kini menyimpan `resourceId = workspaceId` (kolom dan
  metadata).
- CSV export **streaming**: member dibaca per halaman (cursor `id`, 100 per
  halaman), log hanya untuk halaman itu, dan response dikirim chunked tanpa
  `content-length`. Test `C-CSV-1` memverifikasi chunked + isi identik +
  `resourceId` audit.
- Dashboard memakai `attendanceLog.groupBy(["memberId","type"])` dengan
  `_min(timestampServer)` untuk agregasi SQL, menggantikan reduksi seluruh log
  di aplikasi. Hasil dijaga oleh test dashboard yang sudah ada (C-DASH-1…3).

### Langkah 5 — CI hardening

- `scripts/ci-all-tags.sh` meng-enumerasi `checkpoint-1*`…`checkpoint-5*`
  (atau ref yang diberikan), membuat worktree bersih per tag, lalu menjalankan
  `npm ci`, build, typecheck, seluruh test, dan mobile CI. Script mencetak
  `RESULT <tag> PASS|FAIL`, ringkasan `CI_ALL_TAGS`, dan keluar non-zero bila
  ada kegagalan.
- `CI_SKIP_MOBILE=1` (diteruskan sebagai `MOBILE_CI_SKIP=1`) tersedia untuk
  iterasi lokal; CI penuh tetap menjalankan Flutter.
- `README.md` mendokumentasikan perintah dan perilaku script.

### Langkah 6 — Dokumen

- Dokumen ini, `docs/PHASE-6.md`.

## 2. Keputusan

- **SMTP vs provider**: keduanya didukung; SMTP dipakai sebagai jalur utama
  karena tidak menambah dependensi runtime baru selain Nodemailer. Provider
  memakai `fetch` bawaan agar mudah diuji dengan HTTP server lokal.
- **Notifikasi best-effort**: email/push hasil revisi tidak boleh menggagalkan
  review yang sudah commit. Undangan juga non-blocking (keputusan Phase 2
  dipertahankan). Kegagalan selalu dicatat ke logger teredaksi.
- **Push tanpa SDK FCM di Flutter**: lihat §7 (deviasi).
- **Bukti lewat API**: `proof_url` dipertahankan sebagai identifier
  (`/uploads/proofs/<uuid>.<ext>`), tetapi direktori fisik tidak lagi publik.
- **E2E HTTPS**: diperlukan agar atribut cookie production diuji apa adanya;
  HTTP lokal menolak `__Host-`/Secure sehingga halaman terautentikasi tidak
  dapat diverifikasi dengan benar.
- **Redis test opt-in**: `REDIS_REAL_URL` mencegah suite default bergantung
  pada daemon eksternal.

## 3. Verifikasi (output nyata)

| Pemeriksaan | Hasil |
|---|---|
| `npm run test:ci` | **exit 0**, 213 test (web 47, auth 124, database 33, permissions 9); auth 122 pass + 2 skip (Redis nyata) |
| Email (SMTP/provider/template/log) | 10/10 pass |
| Push backend (memory/FCM/tenant/reminder) | 5/5 pass; HTTP 3/3 pass |
| `REDIS_REAL_URL=… node --test dist/redis-real.test.js` | 2/2 pass (multi-instance + Redis mati 503) |
| Playwright `npm run e2e:csp` | **4/4 pass**, tidak ada pelanggaran CSP |
| Register rate limit HTTP | 201 → 403×4 → **429 + Retry-After** |
| Proof endpoint | owner 200, reviewer 200, member lain 403, tenant asing 403, tanpa bukti 404 |
| Index audit | `S-1` pass (information_schema) |
| CSV streaming | chunked tanpa content-length, 121 baris, audit `resourceId` |
| `flutter analyze` | exit 0 |
| `flutter test` | **37 pass** |
| `flutter build apk --debug` | exit 0 |
| `git status --porcelain` | kosong |
| `CI_SKIP_MOBILE=1 bash scripts/ci-all-tags.sh <closure 1–5>` | 2 PASS, 3 FAIL — lihat §3.1 |

### 3.1 Hasil clean-checkout subset closure

```text
RESULT checkpoint-1-closure FAIL exit=1
RESULT checkpoint-2-closure FAIL exit=1
RESULT checkpoint-3-closure FAIL exit=1
RESULT checkpoint-4-closure PASS
RESULT checkpoint-5-closure PASS
CI_ALL_TAGS=FAIL tags=5 exit=1
```

Penyebab: `ci-clean-checkout.sh` menyiapkan **satu** database test dari tree
saat ini, lalu memakai database itu untuk semua tag. Tag Phase 1–3 diuji
dengan katalog/skema Phase 6 (30 permission, tabel M5/M6), sehingga test yang
mengunci jumlah permission atau audit gagal. Build, typecheck, dan instalasi
dependensi tag tersebut **lulus** (suite test memang berjalan); kegagalannya
adalah kontaminasi skema lintas tag, bukan regresi kode tag. Tag 4–5 lulus
karena skemanya sudah kompatibel. Perbaikan harness dicatat sebagai TD-6-R1.

## 4. Cara menjalankan

Backend:

```bash
cd /home/reksa/absen-solusi/app
npm ci
npm run build
npm run typecheck
npm run test:ci
```

Redis nyata (opsional, membuktikan multi-instance):

```bash
redis-server --port 6391 --save '' --appendonly no &
REDIS_REAL_URL=redis://127.0.0.1:6391 \
  node --test --test-force-exit packages/auth/dist/redis-real.test.js
```

Playwright CSP + hidrasi:

```bash
npm run e2e:csp   # menyiapkan DB test, build, HTTPS lokal, 4 test
```

Clean-checkout semua tag Phase 1–5:

```bash
npm run ci:all-tags
CI_SKIP_MOBILE=1 npm run ci:all-tags   # subset cepat tanpa Flutter
```

Mobile: `cd apps/mobile && flutter analyze && flutter test && flutter build apk --debug`.

Konfigurasi baru: `SMTP_*`, `FROM_EMAIL`, `EMAIL_PROVIDER`, `EMAIL_API_KEY`,
`PUSH_TRANSPORT`, `FCM_PROJECT_ID`, `FCM_ACCESS_TOKEN`, `REDIS_REAL_URL`
(test), `ATTENDANCE_PROOF_DIR` (default `storage/proofs`).

## 5. Deviasi

- **Flutter memakai abstraksi push, bukan `firebase_messaging`/Expo SDK**.
  Menambahkan SDK FCM memerlukan `google-services.json` dan Firebase project
  nyata; tanpa itu build APK tidak dapat dijamin hijau. `PushService` adalah
  seam yang tepat untuk adapter SDK tersebut; registrasi token, penanganan
  foreground, dan test sudah ada. Dicatat sebagai TD-6-R2.
- **Notifikasi keterlambatan** baru tersedia sebagai template + transport;
  penjadwalan otomatis belum dipasang ke worker (TD-6-R3).
- **Clean-checkout seluruh tag** dijalankan untuk subset lima tag closure.
  Tag 1–3 gagal karena database test bersama memakai skema Phase 6, bukan
  karena kode tag; harness perlu database per tag (TD-6-R1).
- **Playwright** hanya Chromium, bukan matrix lintas browser (TD-6-R6).

## 6. Tech debt baru

| ID | Item | Alokasi |
|---|---|---|
| TD-6-R1 | `ci-clean-checkout.sh` memakai satu database test untuk semua tag, sehingga tag Phase 1–3 gagal karena skema Phase 6 (30 permission, tabel M5/M6). Sweep penuh juga belum dieksekusi; subset closure: 4–5 PASS, 1–3 FAIL. Perlu database per tag (reset + migrate dari tag itu). | CI hardening |
| TD-6-R2 | Flutter belum memakai SDK FCM/Expo nyata (butuh Firebase project + google-services.json); abstraksi + mock sudah ada. | Mobile push |
| TD-6-R3 | Reminder terjadwal belum terpasang di worker/cron; fungsi `sendAttendanceRemindersForDate` siap dipanggil. | Scheduler |
| TD-6-R4 | Token FCM statis via `FCM_ACCESS_TOKEN`; belum ada refresh OAuth service account. | Push production |
| TD-6-R5 | `device_tokens` tidak memiliki lifecycle (rotasi saat token FCM kedaluwarsa, pembersihan token gagal). | Push ops |
| TD-6-R6 | Playwright hanya Chromium dan berjalan lokal; belum ada pipeline browser matrix/visual regression. | E2E |
| TD-6-R7 | Streaming CSV mengandalkan `ReadableStream` Node; belum ada uji beban memori terukur untuk jutaan baris. | Performance |
| TD-6-R8 | Notifikasi email undangan masih memakai nama workspace opsional; template belum dilokalisasi. | UX email |
| TD-6-R9 | `REDIS_REAL_URL` test opt-in, sehingga CI default tidak menjalankan Redis nyata. | CI hardening |
| TD-6-R10 | Bukti revisi masih filesystem lokal; otorisasi per tenant sudah ada, retensi/object storage belum (lanjutan TD-4-R1). | Storage |

## 7. Batasan yang tidak diklaim

- Email tidak dikirim ke provider nyata; verifikasi memakai mock SMTP/provider.
- Push tidak dikirim ke FCM nyata; verifikasi memakai `MemoryPushTransport` dan
  HTTP mock FCM.
- Redis nyata diverifikasi lokal (binary 8.0.2), bukan cluster production.
- APK yang diverifikasi adalah **debug**, bukan release bertanda tangan.
- iOS belum dibangun di lingkungan ini.
- Sweep clean-checkout penuh semua tag belum selesai, dan tag 1–3 closure
  gagal pada harness database bersama (bukan kegagalan build); lihat TD-6-R1.
