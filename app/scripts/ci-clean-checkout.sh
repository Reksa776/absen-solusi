#!/usr/bin/env bash
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# Kredensial setup dibaca oleh scripts/test-db-setup.mjs dari .env root.
# Sengaja tidak diekspor: test lama menganggap env admin tidak tersedia dan
# akan menjalankan setup (men-drop DB) bila variabel ini bocor ke proses test.

if [ "$#" -gt 0 ]; then
  REFS=("$@")
else
  mapfile -t TAGS < <(git tag -l 'checkpoint-1*' 'checkpoint-2*' 'checkpoint-3*' \
    'checkpoint-4*' 'checkpoint-5*' 'checkpoint-6*' --sort=version:refname)
  REFS=("${TAGS[@]}" HEAD)
fi

WORKTREES=()
cleanup_worktrees() {
  for wt in "${WORKTREES[@]:-}"; do
    if [ -n "$wt" ] && [ -d "$wt" ]; then
      git worktree remove --force "$wt" >/dev/null 2>&1 || true
    fi
  done
}
trap 'cleanup_worktrees' EXIT

failures=0
for ref in "${REFS[@]}"; do
  wt="$(mktemp -d "/tmp/absensi-ci-${ref//\//-}.XXXXXX")"
  WORKTREES+=("$wt")
  echo "===== CLEAN CHECKOUT $ref ====="
  if ! git worktree add --detach "$wt" "$ref" >/dev/null 2>&1; then
    echo "RESULT $ref FAIL worktree"
    failures=$((failures + 1))
    continue
  fi

  # Database terisolasi per tag: tidak ada kontaminasi katalog/migrasi tag lain.
  safe_ref="$(printf '%s' "$ref" | tr 'A-Z' 'a-z' | tr -cd 'a-z0-9')"
  export S1_TEST_DB_NAME="absensi_s1_verify_${safe_ref}"

  (
    set -e
    cd "$wt"
    # Tag Phase 1 awal memakai new URL("../../../.env", import.meta.url)
    # yang di-resolve Turbopack sebagai asset. File kosong memenuhi kontrak
    # build tanpa membawa kredensial; env test tetap berasal dari proses CI.
    : > .env
    : > .env.test
    # Prisma CLI harus tersedia sebelum migrasi tag diterapkan.
    npm ci --no-audit --no-fund
    # Selalu pakai alur terpusat: script setup tag lama tidak seragam dalam
    # membaca S1_TEST_DB_NAME. Migrasi tetap berasal dari worktree tag itu.
    S1_TEST_SKIP_MIGRATIONS=1 S1_TEST_ENV_FILE="$wt/.env.test" \
      node "$ROOT/scripts/test-db-setup.mjs"
    set -a
    # shellcheck disable=SC1091
    . "$wt/.env.test"
    set +a
    (
      cd packages/database
      DATABASE_URL="$DATABASE_URL" APP_DATABASE_URL="$APP_DATABASE_URL" \
        npx prisma migrate deploy
    )
    S1_TEST_GRANT_ONLY=1 S1_TEST_ENV_FILE="$wt/.env.test" \
      node "$ROOT/scripts/test-db-setup.mjs"
    set -a
    # shellcheck disable=SC1091
    . "$wt/.env.test"
    set +a
    export S1_TEST_DB_READY=1
    if node -e "const p=require('./package.json'); process.exit(p.scripts && p.scripts['build:packages'] ? 0 : 1)"; then
      npm run build
    else
      npm run build --workspace @absensi/permissions
      npm run build --workspace @absensi/database
      if [ -f packages/auth/package.json ]; then
        npm run build --workspace @absensi/auth
      fi
      npm run build --workspace @absensi/worker
      npm run build --workspace @absensi/web
    fi
    npm run typecheck
    if node -e "const p=require('./package.json'); process.exit(p.scripts && p.scripts['test:run'] ? 0 : 1)"; then
      npm run test:run
    else
      npm test
    fi
    if [ "${CI_SKIP_MOBILE:-}" != "1" ] && [ -f apps/mobile/pubspec.yaml ]; then
      bash scripts/mobile-ci.sh
    fi
  )
  status=$?
  if [ $status -eq 0 ]; then
    echo "RESULT $ref PASS"
  else
    echo "RESULT $ref FAIL exit=$status"
    failures=$((failures + 1))
  fi
  git worktree remove --force "$wt" >/dev/null 2>&1 || true
done

if [ "$failures" -ne 0 ]; then
  echo "CI_CLEAN_CHECKOUT=fail tags=$failures"
  exit 1
fi
echo "CI_CLEAN_CHECKOUT=pass tags=${#REFS[@]}"
