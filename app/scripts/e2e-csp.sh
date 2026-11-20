#!/usr/bin/env bash
# Playwright E2E untuk CSP nonce + hidrasi. Butuh build produksi dan database.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# Database test kosong: registrasi bootstrap hanya menerima user pertama.
node scripts/test-db-setup.mjs
set -a
# shellcheck disable=SC1091
. ./.env.test
set +a

npm run build
npx playwright test --config apps/web/playwright.config.mjs
