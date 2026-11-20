#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# Suite memakai limiter in-memory deterministik; perilaku production/Redis diuji
# terpisah dengan env eksplisit.
export S1_RATE_LIMITER=memory

if [ "${S1_TEST_DB_READY:-}" != "1" ]; then
  node scripts/test-db-setup.mjs
  set -a
  # shellcheck disable=SC1091
  . ./.env.test
  set +a
  trap 'rm -f "$ROOT/.env.test"' EXIT
fi

npm run test:run
