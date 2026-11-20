#!/usr/bin/env bash
set -euo pipefail

# Mode cepat untuk iterasi lokal; CI penuh tetap menjalankan Flutter.
if [ "${MOBILE_CI_SKIP:-}" = "1" ]; then
  echo "MOBILE_CI=skip"
  exit 0
fi

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT/apps/mobile"

flutter pub get
flutter analyze
flutter test
flutter build apk --debug

echo "MOBILE_CI=pass"
