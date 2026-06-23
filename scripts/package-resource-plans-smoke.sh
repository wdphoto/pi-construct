#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

npx tsc \
  --outDir "$TMP/out" \
  --rootDir "$ROOT" \
  --module NodeNext \
  --moduleResolution NodeNext \
  --target ES2022 \
  --strict \
  --esModuleInterop \
  --skipLibCheck \
  "$ROOT/extensions/construct/package-resource-plans.ts" \
  "$ROOT/extensions/construct/package-filters.ts" \
  "$ROOT/extensions/construct/json.ts" \
  "$ROOT/scripts/package-resource-plans-smoke.ts"

node "$TMP/out/scripts/package-resource-plans-smoke.js"
