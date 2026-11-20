# Aplikasi Absensi

Monorepo aplikasi absensi. Status saat ini: **scaffold** — belum ada fitur.

## Struktur

```
app/
├── apps/
│   ├── web/          Next.js App Router (TypeScript)
│   └── worker/       proses background (placeholder)
├── packages/
│   ├── database/     Prisma (schema masih kosong, tanpa model fitur)
│   └── permissions/  katalog permission (masih kosong)
├── package.json      npm workspaces: apps/*, packages/*
└── tsconfig.json     konfigurasi TypeScript dasar
```

`install.sh` di direktori induk bukan bagian dari proyek ini dan tidak disentuh.

## Perintah

| Perintah | Keterangan |
|---|---|
| `npm install` | pasang dependensi seluruh workspace |
| `npm run typecheck` | TypeScript di root + semua workspace |
| `npm run build` | build semua workspace yang punya skrip build |
| `npm test` | jalankan test workspace yang sudah ada |
| `npm run prisma:generate` | generate Prisma Client |
| `npm run prisma:validate` | validasi schema Prisma |
| `npm run e2e:csp` | Playwright E2E CSP nonce + hidrasi (HTTPS lokal) |
| `npm run ci:all-tags` | clean-checkout semua tag checkpoint Phase 1–5 |
| `CI_SKIP_MOBILE=1 npm run ci:all-tags` | sama, tanpa Flutter (debug cepat) |

## CI

`npm run test:ci` menjalankan build, typecheck, dan seluruh suite workspace.
`npm run ci:all-tags` meng-enumerasi setiap tag `checkpoint-1*`…`checkpoint-5*`,
 membuat worktree bersih, lalu menjalankan `npm ci`, build, typecheck, seluruh
test, dan mobile CI (`flutter analyze`, `flutter test`, `flutter build apk
--debug`). Script keluar non-zero bila ada satu tag gagal dan mencetak
`RESULT <tag> PASS|FAIL`.

## Database

Salin `.env.example` menjadi `.env`, lalu isi `DATABASE_URL`. Belum ada
migration dan belum ada tabel: model fondasi ditambahkan pada Phase 1.

## Dokumentasi

- [`docs/TENANT-ISOLATION.md`](docs/TENANT-ISOLATION.md) — semantik `withTenant`,
  call site `systemDb()`, dan batasan isolasi tenant.
- [`docs/PHASE-1.md`](docs/PHASE-1.md) — fondasi platform.
- [`docs/PROJECT-CURRENT-STATE-AUDIT.md`](docs/PROJECT-CURRENT-STATE-AUDIT.md) — audit kondisi proyek.
- [`docs/NEXT-EXECUTION-PLAN.md`](docs/NEXT-EXECUTION-PLAN.md) — rencana eksekusi Phase 2.
- [`docs/PHASE-4.md`](docs/PHASE-4.md) — revisi kehadiran.
- [`docs/PHASE-5.md`](docs/PHASE-5.md) — dashboard, rekap, hari libur.
- [`docs/PHASE-6.md`](docs/PHASE-6.md) — hardening dan notifikasi.
