#!/usr/bin/env bash
set -euo pipefail
# Isolate even when run standalone: clear inherited agent-dir overrides that bypass $HOME.
unset PI_CODING_AGENT_DIR PI_CODING_AGENT_SESSION_DIR
export PI_OFFLINE=1

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP="$ROOT/.tmp/skill-repositories-smoke-$$"
trap 'rm -rf "$TMP"' EXIT
HOME_DIR="$TMP/home-fixture"
mkdir -p "$HOME_DIR"
export HOME="$HOME_DIR"
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
  "$ROOT/scripts/skill-repositories-smoke.ts"

node "$TMP/out/scripts/skill-repositories-smoke.js"
