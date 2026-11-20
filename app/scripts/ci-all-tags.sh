#!/usr/bin/env bash
# Clean-checkout seluruh tag Phase 1–6. Setiap tag dibangun dan diuji dari
# worktree bersih dengan database terisolasi; gagal bila satu tag gagal.
#
# Pemakaian:
#   bash scripts/ci-all-tags.sh                 # semua tag checkpoint-1..6
#   bash scripts/ci-all-tags.sh checkpoint-4a   # ref tertentu
#   CI_SKIP_MOBILE=1 bash scripts/ci-all-tags.sh  # lewati Flutter (debug lokal)
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if [ "$#" -gt 0 ]; then
  REFS=("$@")
else
  mapfile -t REFS < <(
    git tag -l 'checkpoint-1*' 'checkpoint-2*' 'checkpoint-3*' \
      'checkpoint-4*' 'checkpoint-5*' 'checkpoint-6*' --sort=version:refname
  )
fi

if [ "${#REFS[@]}" -eq 0 ]; then
  echo "Tidak ada tag checkpoint Phase 1–5 untuk diuji" >&2
  exit 1
fi

echo "CLEAN_CHECKOUT_TAGS=${#REFS[@]}"
echo "TAGS: ${REFS[*]}"

# Delegasi ke clean-checkout yang sudah menyiapkan DB test, build, typecheck,
# test:run, dan mobile CI per worktree.
if [ "${CI_SKIP_MOBILE:-}" = "1" ]; then
  # ci-clean-checkout memeriksa CI_SKIP_MOBILE sebelum memanggil Flutter.
  export CI_SKIP_MOBILE=1
fi

bash scripts/ci-clean-checkout.sh "${REFS[@]}"
status=$?

if [ $status -eq 0 ]; then
  echo "CI_ALL_TAGS=PASS tags=${#REFS[@]}"
else
  echo "CI_ALL_TAGS=FAIL tags=${#REFS[@]} exit=$status"
fi
exit $status
