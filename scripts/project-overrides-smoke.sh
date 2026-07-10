#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP="$ROOT/.tmp/project-overrides-smoke-$$"
trap 'rm -rf "$TMP"' EXIT
mkdir -p "$TMP"

npx tsc \
  --outDir "$TMP/out" \
  --rootDir "$ROOT" \
  --module NodeNext \
  --moduleResolution NodeNext \
  --target ES2022 \
  --strict \
  --esModuleInterop \
  --skipLibCheck \
  "$ROOT/scripts/project-overrides-smoke.ts"

node "$TMP/out/scripts/project-overrides-smoke.js"
