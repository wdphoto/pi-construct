#!/usr/bin/env bash
set -euo pipefail
# Isolate even when run standalone: clear inherited agent-dir overrides that bypass $HOME.
unset PI_CODING_AGENT_DIR PI_CODING_AGENT_SESSION_DIR
export PI_OFFLINE=1

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
HOME_DIR="$TMP/home-fixture"
mkdir -p "$HOME_DIR"
export HOME="$HOME_DIR"

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
