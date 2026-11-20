# Phase 2 — Rekomendasi Checkpoint Berikutnya

**Tanggal:** 2026-11-19
**Status:** REKOMENDASI — **BELUM DIEKSEKUSI**
**Posisi:** setelah Unit 2A (Task 2.1, 2.3, 2.5)
**Roadmap:** tidak diubah. Dokumen ini tidak menambah, memindahkan, atau
mengganti nama Phase/task.

---

## 1. Kondisi saat ini

| Item | Status |
|---|---|
| Task 2.1 — read API workspace/member | Implementasi selesai; **PASS WITH LIMITATIONS** (test DB belum jalan) |
| Task 2.3 — readiness | Implementasi selesai; **PASS WITH LIMITATIONS** (DB nyata belum diuji) |
| Task 2.5 — dokumentasi tenant | **PASS** |
| Task 2.2 — accept invitation | NOT STARTED |
| Task 2.4 — rate limit per-user | NOT STARTED |
| Task 2.6 — UI workspace/member | NOT STARTED |
| Task 2.7 — office settings | NOT STARTED |
| Critical S-1 — eskalasi role | **OPEN** |
| Checkpoint Phase 2 | **BELUM ADA yang PASS** |

**Yang sudah terbukti:** typecheck 5 workspace, build database/auth/web, 15 test
DB-free lulus, route `/api/health/ready` terdaftar di build produksi.

**Yang belum terbukti:** 50 test berbasis DB (termasuk L1–L5), perilaku handler
HTTP, readiness saat DB benar-benar mati, isolasi tenant pada runtime.

Sebelum unit berikutnya dimulai, pemilik proyek perlu menyetujui:

1. Commit pekerjaan Phase 1 + Unit 2A (approval Unit 2A melarang commit).
2. Menyalakan MariaDB dev dan menjalankan suite penuh untuk mengubah status
   NOT VERIFIED menjadi hasil nyata.
3. Keputusan apakah S-1 ditutup sebelum atau sesudah 2.2/2.4.

---

## 2. Rekomendasi unit berikutnya: **2B — Invitation & Abuse Control**

Isi: **Task 2.2 + Task 2.4** dalam satu unit, tanpa migration.

| Task | Alasan masuk unit ini |
|---|---|
| 2.2 Accept invitation | Melengkapi alur undangan yang sudah punya tabel, token, dan expiry; tanpa 2.2, invitation Phase 1 tidak pernah bisa diterima |
| 2.4 Rate limit per-user di route workspace | Menutup penyalahgunaan invite/role-change; limiter generik belum ada, tetapi pola `enforceLoginRateLimit` bisa diikuti |

Keduanya tidak membutuhkan perubahan schema dan tidak menyentuh RBAC domain.
Keduanya juga mengurangi risiko sebelum UI member (2.6) dibuka.

### 2.1 Usulan cakupan Task 2.2

- `POST /api/invitations/accept` (atau kontrak yang disetujui) menerima token
  mentah; hash SHA-256 dicari, status `PENDING`, belum kedaluwarsa.
- Wajib sesi login dengan email yang sama dengan `invitation.email`
  (case-insensitive); jika tidak → 403/404 yang tidak membocorkan detail.
- Transaksi: buat/aktifkan `workspace_member`, pasang role dari `role_id`,
  set invitation `ACCEPTED` + `accepted_at`, audit `member.accept`.
- Idempoten: token yang sudah diterima → 409/410 yang konsisten; jangan
  membuat membership ganda (`@@unique([tenantId, userId])`).
- Set `active_tenant_id` sesi bila user belum punya workspace aktif; bila
  sudah, jangan diam-diam memindahkan tenant.
- Tanpa email delivery (TD-1-R11 tetap terbuka); token masih diteruskan manual.

### 2.2 Usulan cakupan Task 2.4

- Limiter generik per `userId + route + bucket` (bukan hanya IP).
- Fail-closed seperti login: error limiter → 503, bukan lolos.
- Header `Retry-After` pada 429; pesan tidak membocorkan sisa kuota internal.
- Terapkan minimal pada `POST /api/workspaces`, `POST .../members`,
  `PATCH .../role`.
- In-memory tetap dapat diterima untuk satu instance (TD-1-R8), tetapi
  dokumentasikan batasnya.
- Tambahkan test DB-free untuk algoritma limiter (window, reset, isolasi bucket).

---

## 3. Yang **tidak** direkomendasikan pada unit berikutnya

| Item | Alasan |
|---|---|
| 2.6 UI member | S-1 masih terbuka; UI akan mengekspos tombol ubah role yang bisa dipakai untuk eskalasi |
| 2.7 office settings | Memerlukan model/tabel baru → migration; butuh approval terpisah dan keputusan produk (timezone, jam kerja) |
| Perbaikan S-1 dicampur ke 2B | Perubahan otorisasi role punya blast radius berbeda; sebaiknya unit keamanan sendiri |
| Perubahan katalog RBAC (TD-2-R1) | Keputusan produk; menyentuh Phase 3 |

---

## 4. Urutan checkpoint yang diusulkan

| Checkpoint | Isi | Syarat lulus |
|---|---|---|
| **2B** | 2.2 + 2.4 | Test DB invitation/limit lulus; tidak ada kebocoran token; 429 + `Retry-After` |
| **2C** | S-1 (unit keamanan) | Assign owner oleh admin ditolak; last owner tidak bisa diturunkan; test DB lulus |
| **2D** | 2.6 UI + 2.7 office settings | UI memakai policy per-method; migration 2.7 disetujui; S-1 sudah tertutup |
| **Phase 2 Checkpoint** | seluruh task 2.x | Semua test DB lulus, tidak ada Critical terbuka, rate limit aktif |

Urutan ini tidak mengubah penomoran roadmap; hanya mengatur eksekusi.

---

## 5. Risiko unit 2B

| Risiko | Mitigasi |
|---|---|
| Token undangan bocor lewat log/audit | Jangan pernah menulis token mentah; audit hanya `invitationId` + email |
| Membership ganda saat accept bersamaan | Transaksi + unique `(tenant_id, user_id)`; tangani P2002 |
| Email invitation berbeda kapital | Normalisasi dengan `normalizeEmail()` sebelum compare |
| Rate limiter mengunci pengguna sah | Bucket terpisah per route; window jelas; `Retry-After` |
| Limiter in-memory tidak konsisten multi-instance | Catat sebagai TD-1-R8; jangan klaim global |
| Test mencampur data dev | Gunakan DB dev port 3307; jangan arahkan `DATABASE_URL` ke DB lain |

---

## 6. Definisi selesai untuk checkpoint 2B

1. `POST` accept invitation berhasil untuk token valid + email cocok.
2. Token salah/kedaluwarsa/sudah dipakai memberi status konsisten tanpa
   membocorkan keberadaan invitation.
3. Membership dan role terbentuk tepat satu; audit `member.accept` tertulis.
4. Rate limit mengembalikan 429 + `Retry-After`; error limiter → 503.
5. Seluruh test lama + baru lulus terhadap DB dev.
6. `npm run typecheck` dan `npm run build` exit 0.
7. Tidak ada migration, perubahan `.env`, atau dependency baru.
8. Laporan unit mencatat hasil nyata, bukan klaim.

---

## 7. Keputusan yang masih menunggu pemilik proyek

1. **Commit**: bolehkah pekerjaan Phase 1 + Unit 2A di-commit sekarang?
2. **DB test**: bolehkah MariaDB dev dinyalakan dan `resetDatabase()` dijalankan
   pada database development?
3. **S-1**: unit keamanan tersendiri sebelum 2.6, atau digabung ke 2B?
4. **TD-2-R1**: kapan katalog/role absensi ditetapkan (dibutuhkan sebelum Phase 3)?
5. **2.7**: apakah `office_settings` memakai tabel baru (migration) atau
   menumpang konfigurasi workspace?

---

## 8. Stop condition

Dokumen ini **hanya rekomendasi**. Tidak ada Task 2.2, 2.4, 2.6, 2.7, S-1,
atau Phase 3 yang dikerjakan. Eksekusi menunggu persetujuan pemilik proyek.
