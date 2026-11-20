# Phase 1 — Fondasi Platform

**Tanggal:** 2026-11-18
**Lokasi:** `/home/reksa/absen-solusi/app`
**Status:** Komponen A–H diimplementasikan; temuan audit independen 2026-11-19 ditutup atau didokumentasikan di [`PHASE-1-FIXES.md`](./PHASE-1-FIXES.md), dengan verifikasi nyata di §6.

Dokumen ini mencatat keputusan, deviasi, dan tech debt. Angka test diambil dari
eksekusi nyata terhadap MariaDB dev (bukan mock).

---

## 1. Status komponen

| Komponen | Status | Artefak utama |
|---|---|---|
| A. Database & tenant foundation | Selesai | `schema.prisma` (12 tabel), M1, `grants.sql`, `withTenant`, `systemDb`, `writeAudit` |
| B. Auth & session | Selesai | `packages/auth/src/{password,session,csrf,rate-limit,http,users}.ts`, `/api/auth/*` |
| C. RBAC | Selesai | `requirePermission()` di `http.ts`, matrix 162 kombinasi di `rbac.test.ts` |
| D. Workspace/member/invitation | Selesai | `workspaces.ts`, `/api/workspaces*` |
| E. Audit | Selesai | audit `auth.register_bootstrap`, `auth.login`, `workspace.create`, `member.invite`, `role.change` |
| F. Security headers & logger | Selesai | `security-headers.ts`, `logger.ts`, `src/middleware.ts` |
| G. Web shell + mobile placeholder | Selesai | `/sign-in`, landing workspace aktif, `apps/mobile/README.md` |
| H. Test suite | Selesai | test B/C/D/E/F/H + test kebijakan route di `apps/web/test` |

## 2. Perilaku auth (B)

- Satu session store (`sessions`) melayani **cookie web** dan **Bearer mobile**.
  Token mentah 32 byte (base64url); DB hanya menyimpan SHA-256 hex 64 karakter.
- Cookie produksi `__Host-aos_session` (HttpOnly, Secure, SameSite=Lax); di dev
  `aos_session` (tanpa Secure karena http://localhost).
- TTL absolut 7 hari, idle 24 jam, `last_seen_at` diperbarui maksimal sekali per
  jam. `rotateSession()` mengganti token pada session yang sama tanpa
  memperpanjang TTL; `revokeAllSessionsForUser()` mencabut semua sesi.
  Perubahan role dan transfer ownership mencabut seluruh sesi target/kedua
  pihak yang privilege-nya berubah; token baru harus diperoleh lewat login
  ulang.
- Password Argon2id `m=19456, t=2, p=1`, minimum 12 karakter.
- Register hanya bootstrap: `ALLOW_REGISTRATION=true` **dan** tabel `users`
  kosong. Bootstrap membuat user + workspace + 6 role + membership owner dalam
  satu transaksi agar audit bootstrap punya `tenant_id` non-null.

### CSRF: pilihan pendekatan

Web memakai **double-submit cookie**: token acak di cookie `aos_csrf` (bisa
dibaca JS) dan header `x-csrf-token`; dibandingkan constant-time. Wajib pada
semua request non-GET mode cookie.

Mobile (Bearer) **tidak** memakai CSRF. Alasannya: browser tidak mengirim
header `Authorization` otomatis pada request lintas situs, sehingga serangan
CSRF tidak memiliki cara menempelkan token; menambahkan double-submit hanya
menambah state tanpa manfaat. Login mobile menyatakan mode secara eksplisit
lewat `X-Auth-Mode: bearer`; header ini diterima tanpa `Authorization` dummy
pada route login. Route register tetap mewajibkan CSRF cookie-mode, dan token
hanya dikembalikan di body untuk mode bearer (web memakai cookie httpOnly).

### Rate limit login

10 percobaan / 15 menit per IP dan per akun (bucket terpisah). Jika backend
rate limiter melempar error, login **ditolak 503** (fail-closed), bukan
dilewatkan. Implementasi Phase 1 in-memory per proses (lihat TD-1-R8).

## 3. Workspace, member, invitation (D)

- `POST /api/workspaces`: transaksi berisi create workspace + 6 role +
  membership ACTIVE + `WORKSPACE_OWNER`. Gagal di langkah mana pun = rollback
  total (ekuivalen hapus workspace + cascade).
- `POST /api/workspaces/:id/members`: invite by email, status `PENDING`,
  expiry 7 hari, `token_hash` = SHA-256 token mentah (32 byte). Respons API
  produksi tidak memuat token mentah; echo token hanya tersedia di non-
  production dengan `S1_INVITATION_TOKEN_ECHO=true` (belum ada email/accept,
  TD-1-R11).
- `PATCH .../members/:memberId/role`: role baru di-`upsert` **sebelum** role
  lama dihapus, dalam satu transaksi. Self role change → 400. No-op → tidak
  menulis audit.
- Otoritas tenant berasal dari `active_tenant_id` di session;
  `:workspaceId` hanya klaim. Workspace asing dan tidak ada memberi respons
  **404 identik**, tanpa baris tertulis.
- Semantik isolasi tenant (allowlist `withTenant`, `systemDb()`, batasan):
  [`docs/TENANT-ISOLATION.md`](./TENANT-ISOLATION.md).

## 4. Audit (E)

`writeAudit()` dipanggil untuk lima aksi wajib. Metadata tidak pernah memuat
token/hash (dan redaksi otomatis menangkap kunci sensitif). `ip_hash` adalah
SHA-256 32 byte. Aksi berisiko `workspace.create`, `role.change`, dan
`ownership.transfer` menulis audit **di dalam transaksi yang sama**; kegagalan
audit membatalkan seluruh operasi. Login/register/invite tetap best-effort dan
kegagalannya dicatat ke logger tanpa payload sensitif (TD-1-R14).

Aturan pemakaian `systemDb()` dan review isolasi tenant: lihat
[`docs/TENANT-ISOLATION.md`](./TENANT-ISOLATION.md).

## 5. Keputusan & deviasi

| ID | Keputusan | Alasan |
|---|---|---|
| D-1-1 | `BackgroundJobAttempt` sebagai tabel ke-12 | spesifikasi menyebut 12 tabel DML tetapi hanya 11 model |
| D-1-2 | ID UUID string `CHAR(36)` | konsisten dengan composite key `(tenant_id, id)` |
| D-1-3 | `audit_logs.tenant_id` tanpa FK | audit bertahan walau workspace dihapus; append-only |
| D-1-4 | Akun DB dipisah: `root` (migration) vs `absensi_app` (runtime) | grant append-only hanya bermakna bila runtime tanpa UPDATE/DELETE |
| D-1-5 | Dev DB user-space di `app/.devdb/` port 3307 | tidak ada akses root MariaDB sistem |
| D-1-6 | Bootstrap register sekaligus membuat workspace | `audit_logs.tenant_id` NOT NULL; user pertama butuh tenant |
| D-1-7 | Cookie sesi tidak dirotasi otomatis tiap request | rotasi hanya saat privilege berubah; menghindari race multi-tab |
| D-1-8 | `requirePermission` me-resolve role dari DB setiap request | perubahan role berlaku pada request berikutnya dengan session sama |
| D-1-9 | Role/ownership change mencabut seluruh session target (dan kedua pihak pada transfer) | mencegah token lama membawa privilege lama; token baru diperoleh lewat login ulang |
| D-1-10 | CSP mempertahankan `script-src 'unsafe-inline'` | Next 16 App Router menyisipkan bootstrap inline; nonce memerlukan rendering dinamis per request dan berisiko memecah shell statis. Risiko XSS mitigation lebih lemah dicatat di TD-1-R9; bukan diklaim sebagai CSP ketat. |
| D-1-11 | Login/register cookie-mode mewajibkan CSRF; bearer tidak | double-submit hanya relevan untuk cookie |
| D-1-12 | Invitation token tidak dikembalikan di respons produksi; echo dev opt-in | mencegah token masuk log/client produksi; belum ada email/accept |
| D-1-13 | Rate limiter in-memory | Phase 1 satu instance; fail-closed bila error |

## 6. Verifikasi (lihat ringkasan eksekusi terakhir)

- `npm ci && npm run build && npm run typecheck` — exit 0 dari checkout bersih.
- `npm run test:ci` — setup DB test terisolasi + seluruh suite; **117 pass, 0 fail**
  (web 2, auth 80, database 26, permissions 9).
- `npm run ci:clean-checkout` — tag 1a–1f, 1i–1n, dan HEAD semuanya PASS
  (13 clean checkouts, exit 0).
- `npx prisma validate` — schema valid.
- `npx prisma migrate deploy` — tidak ada migration tertunda.
- Pemeriksaan HTTP nyata: login mobile `X-Auth-Mode: bearer` 200 + token;
  tanpa mode/CSRF 403; 429 membawa `Retry-After`; respons undangan produksi
  tanpa token; header CSP/HSTS/nosniff/DENY/Referrer-Policy;
  `Cache-Control: no-store` untuk API.

## 7. Tech debt

| ID | Item | Alokasi |
|---|---|---|
| TD-1-R1 | ~~Auth/session/CSRF/Bearer~~ — selesai | — |
| TD-1-R2 | ~~`requirePermission` + matrix 162~~ — selesai | — |
| TD-1-R3 | ~~Route workspace/invite/role change~~ — selesai | — |
| TD-1-R4 | ~~Security headers + logger redaction~~ — selesai | — |
| TD-1-R5 | ~~Web sign-in/landing~~ — selesai | — |
| TD-1-R6 | ~~Test auth/CSRF/route permission~~ — selesai | — |
| TD-1-R7 | Dev DB user-space dijalankan manual | operasional |
| TD-1-R8 | Rate limiter in-memory; multi-instance butuh store bersama (Redis/DB). `Retry-After` sudah dikirim pada 429/503. | Phase 2 |
| TD-1-R9 | CSP `script-src 'unsafe-inline'` dipertahankan karena bootstrap inline Next 16; nonce/hash belum diterapkan. Risiko: mitigasi XSS lebih lemah dari CSP ketat. | Phase 2 |
| TD-1-R10 | ~~`X-Forwarded-For` dipercaya tanpa allowlist proxy~~ — selesai: default-deny, rightmost XFF hanya bila `TRUST_PROXY=true` | — |
| TD-1-R11 | Email + halaman accept undangan belum ada; token tidak lagi dikembalikan pada respons produksi. | Phase 2 |
| TD-1-R12 | Switcher workspace & modul absensi belum ada; **Phase 2**, bukan diklaim selesai di Phase 1. | Phase 2 |
| TD-1-R13 | `active_tenant_id` selalu workspace pertama; belum ada endpoint switch. **Phase 2.** | Phase 2 |
| TD-1-R14 | Audit best-effort hanya untuk login/register/invite; aksi berisiko fail-closed. Outbox/retry belum ada. | Phase 2 (outbox) |
| TD-1-R15 | ~~Test B7 memakai cookie/header berbeda; route login/register diuji lewat HTTP nyata~~ — selesai | — |
| TD-1-R16 | Raw query di dalam `$transaction` belum dijaga proxy otomatis; pemakaian saat ini hanya lock workspace tervalidasi | Phase 2 |

## 8. Menjalankan

```bash
# MariaDB dev (background)
/usr/sbin/mariadbd --no-defaults \
  --datadir="$PWD/.devdb/data" --socket="$PWD/.devdb/run/mysqld.sock" \
  --port=3307 --bind-address=127.0.0.1 \
  --pid-file="$PWD/.devdb/run/mysqld.pid" \
  --log-error="$PWD/.devdb/log/mysqld.log" --skip-name-resolve &

npm run prisma:validate
npm run test:ci   # setup DB test terisolasi + build + typecheck + seluruh suite
npm run dev --workspace @absensi/web   # http://localhost:3000/sign-in
```

`.env` (gitignored) memuat `DATABASE_URL` (root) dan `APP_DATABASE_URL`
(runtime), `ALLOW_REGISTRATION=true` untuk bootstrap. `npm run test:ci`
membuat database `absensi_s1_verify_*`, user `s1_*`, migration, dan grant
secara otomatis; kredensial test hanya ditulis ke `.env.test` sementara.

### Worktree bersih

Worktree bersih tidak membawa `.env` karena file itu gitignored. Berikan URL
admin database lewat environment sebelum menjalankan suite, misalnya:

```bash
S1_TEST_ADMIN_URL='mysql://admin:password@127.0.0.1:3306/' npm run test:ci
# alternatif: DATABASE_URL='mysql://admin:password@127.0.0.1:3306/'
```

`S1_TEST_ADMIN_URL` lebih diprioritaskan daripada `DATABASE_URL`. URL ini hanya
butuh izin membuat database/user test; database `absensi_s1_verify_*` dan
kredensial test dibuat ulang otomatis. Jika keduanya tidak ada, setup berhenti
dengan pesan yang menyebut kedua variabel dan contoh bentuk URL (tanpa
kredensial nyata). Smoke test-nya ada di
`apps/web/test/test-db-env.test.mjs`.

## 9. Mobile

Flutter menyusul di **Phase 3** memakai API yang sama dengan Bearer token;
lihat `apps/mobile/README.md`.

Workspace switcher dan endpoint pindah `active_tenant_id` **belum ada** di
Phase 1. Keduanya ditunda ke **Phase 2** (TD-1-R12/R13); tidak ada klaim bahwa
UI/endpoint tersebut sudah tersedia.

## 10. Checkpoint dan koreksi klaim

- Tag yang benar-benar ada: `checkpoint-1a` (`b9c52bc`), `1b` (`10943df`),
  `1c` (`49a9e91`), `1d` (`1d43473`), `1e` (`49ea9ac`), `1f` (`47e77c0`).
- **Tidak ada `checkpoint-1g` atau `checkpoint-1h`.** Tidak ada commit/tag
  terpisah untuk G/H; klaim lama yang menyebut checkpoint tersebut dikoreksi
  di sini. Riwayat tidak ditulis ulang.
- Perbaikan audit: `1i` (`153084b`) tenant mutation, `1j` (`f32a511`) CI
  clean checkout, `1k` (`bd56fb0`) mobile bearer/TRUST_PROXY/session revocation,
  `1l` (`7ad64e9`) reproducible test:ci, `1m` (`5dfc44c`) MEDIUM/M-01..M-07,
  `1n` (`df91153`) LOW/L-01..L-03.
- Laporan bukti lengkap: [`PHASE-1-FIXES.md`](./PHASE-1-FIXES.md).
