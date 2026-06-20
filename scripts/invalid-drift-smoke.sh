#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

PKG_DIR="$TMP/construct-invalid-drift-package"
mkdir -p "$PKG_DIR/extensions"

cat > "$PKG_DIR/package.json" <<'JSON'
{
  "name": "construct-invalid-drift-package",
  "version": "0.0.0",
  "type": "module",
  "pi": {
    "extensions": ["extensions/noop.ts"]
  }
}
JSON

cat > "$PKG_DIR/extensions/noop.ts" <<'TS'
export default function noop() {}
TS

construct_pi() {
  local home="$1"
  local project="$2"
  local prompt="$3"
  (
    cd "$project"
    HOME="$home" pi --no-extensions -e "$ROOT" -p "$prompt"
  )
}

write_settings_with_pkg() {
  local project="$1"
  mkdir -p "$project/.pi"
  python3 - "$project" "$PKG_DIR" <<'PY'
import json
import pathlib
import sys
project = pathlib.Path(sys.argv[1])
source = sys.argv[2]
(project / ".pi/settings.json").write_text(json.dumps({"packages": [source]}, indent=2) + "\n")
PY
}

printf '== invalid user catalog JSON ==\n'
HOME_A="$TMP/home-invalid-catalog"
PROJECT_A="$TMP/project-invalid-catalog"
mkdir -p "$HOME_A/.pi/agent/construct" "$PROJECT_A"
write_settings_with_pkg "$PROJECT_A"
printf '{ invalid catalog\n' > "$HOME_A/.pi/agent/construct/catalog.json"
OUTPUT="$(construct_pi "$HOME_A" "$PROJECT_A" '/construct load' 2>&1)"
grep -Fq 'Construct load failed.' <<<"$OUTPUT"
grep -Fq 'Construct library catalog is invalid JSON' <<<"$OUTPUT"
grep -Fq '{ invalid catalog' "$HOME_A/.pi/agent/construct/catalog.json"
grep -Fq '{ invalid catalog' "$HOME_A/.pi/agent/construct/catalog.json"
test ! -e "$PROJECT_A/.pi/construct.json"

printf '== invalid project settings JSON ==\n'
HOME_B="$TMP/home-invalid-settings"
PROJECT_B="$TMP/project-invalid-settings"
mkdir -p "$HOME_B" "$PROJECT_B/.pi"
printf '{ invalid settings\n' > "$PROJECT_B/.pi/settings.json"
OUTPUT="$(construct_pi "$HOME_B" "$PROJECT_B" '/construct load' 2>&1)"
grep -Fq 'Construct load failed.' <<<"$OUTPUT"
grep -Fq '.pi/settings.json is invalid JSON' <<<"$OUTPUT"
grep -Fq '{ invalid settings' "$PROJECT_B/.pi/settings.json"
test ! -e "$PROJECT_B/.pi/construct.json"
test ! -e "$HOME_B/.pi/agent/construct/catalog.json"

printf '== invalid project construct JSON ==\n'
HOME_C="$TMP/home-invalid-construct"
PROJECT_C="$TMP/project-invalid-construct"
mkdir -p "$HOME_C" "$PROJECT_C/.pi"
write_settings_with_pkg "$PROJECT_C"
printf '{ invalid construct\n' > "$PROJECT_C/.pi/construct.json"
OUTPUT="$(construct_pi "$HOME_C" "$PROJECT_C" '/construct load' 2>&1)"
grep -Fq 'Construct load failed.' <<<"$OUTPUT"
grep -Fq '.pi/construct.json is invalid JSON' <<<"$OUTPUT"
grep -Fq '{ invalid construct' "$PROJECT_C/.pi/construct.json"
test ! -e "$HOME_C/.pi/agent/construct/catalog.json"

printf '== load preserves duplicate catalog-id sources ==\n'
HOME_DUP="$TMP/home-duplicate-catalog-ids"
PROJECT_DUP="$TMP/project-duplicate-catalog-ids"
SOURCE_ONE="$TMP/one/tool"
SOURCE_TWO="$TMP/two/tool"
mkdir -p "$HOME_DUP/.pi/agent/construct" "$PROJECT_DUP/.pi" "$SOURCE_ONE" "$SOURCE_TWO"
python3 - "$HOME_DUP" "$PROJECT_DUP" "$SOURCE_ONE" "$SOURCE_TWO" <<'PY'
import json
import pathlib
import sys
home = pathlib.Path(sys.argv[1])
project = pathlib.Path(sys.argv[2])
source_one = str(pathlib.Path(sys.argv[3]).resolve())
source_two = str(pathlib.Path(sys.argv[4]).resolve())
(home / ".pi/agent/construct/catalog.json").write_text(json.dumps({
  "version": 1,
  "items": [
    {"id": "tool", "kind": "package", "source": source_one},
    {"id": "tool", "kind": "package", "source": source_two}
  ],
  "profiles": []
}, indent=2) + "\n")
(project / ".pi/settings.json").write_text(json.dumps({"packages": [source_one, source_two]}, indent=2) + "\n")
PY
OUTPUT="$(construct_pi "$HOME_DUP" "$PROJECT_DUP" '/construct load' 2>&1)"
grep -Fq 'Construct load complete.' <<<"$OUTPUT"
python3 - "$PROJECT_DUP" "$SOURCE_ONE" "$SOURCE_TWO" <<'PY'
import json
import pathlib
import sys
project = pathlib.Path(sys.argv[1])
expected = {str(pathlib.Path(sys.argv[2]).resolve()), str(pathlib.Path(sys.argv[3]).resolve())}
construct = json.loads((project / ".pi/construct.json").read_text())
items = construct.get("items", {})
sources = {item.get("source") for item in items.values()}
assert len(items) == 2, construct
assert sources == expected, construct
assert all(item.get("enabled") is True for item in items.values()), construct
PY

printf '== drift: metadata enabled but settings missing source ==\n'
HOME_D="$TMP/home-drift"
PROJECT_D="$TMP/project-drift"
mkdir -p "$HOME_D" "$PROJECT_D/.pi"
cat > "$PROJECT_D/.pi/settings.json" <<'JSON'
{
  "packages": []
}
JSON
python3 - "$PROJECT_D" "$PKG_DIR" <<'PY'
import json
import pathlib
import sys
project = pathlib.Path(sys.argv[1])
source = sys.argv[2]
(project / ".pi/construct.json").write_text(json.dumps({
  "version": 1,
  "managedBy": "the-construct",
  "items": {
    "construct-invalid-drift-package": {
      "kind": "package",
      "source": source,
      "enabled": True
    }
  }
}, indent=2) + "\n")
PY
OUTPUT="$(construct_pi "$HOME_D" "$PROJECT_D" '/construct status' 2>&1)"
grep -Fq 'drift: enabled in Construct metadata, missing from .pi/settings.json' <<<"$OUTPUT"

printf '== normalized local path does not drift ==\n'
HOME_F="$TMP/home-normalized-status"
PROJECT_F="$TMP/project-normalized-status"
mkdir -p "$HOME_F" "$PROJECT_F/.pi" "$PROJECT_F/pkg/extensions"
cat > "$PROJECT_F/.pi/settings.json" <<'JSON'
{
  "packages": ["../pkg"]
}
JSON
python3 - "$PROJECT_F" <<'PY'
import json
import pathlib
import sys
project = pathlib.Path(sys.argv[1])
source = str((project / "pkg").resolve())
(project / ".pi/construct.json").write_text(json.dumps({
  "version": 1,
  "managedBy": "the-construct",
  "items": {
    "pkg": {
      "kind": "package",
      "source": source,
      "enabled": True
    }
  }
}, indent=2) + "\n")
PY
OUTPUT="$(construct_pi "$HOME_F" "$PROJECT_F" '/construct status full' 2>&1)"
grep -Fq 'pkg (package, enabled)' <<<"$OUTPUT"
! grep -Fq 'drift:' <<<"$OUTPUT"

printf '== load recognizes requestedSource relative to cwd ==\n'
HOME_G="$TMP/home-requested-source-sync"
PROJECT_G="$TMP/project-requested-source-sync"
mkdir -p "$HOME_G" "$PROJECT_G/.pi" "$PROJECT_G/pkg/extensions"
cat > "$PROJECT_G/.pi/settings.json" <<'JSON'
{
  "packages": ["../pkg"]
}
JSON
python3 - "$PROJECT_G" <<'PY'
import json
import pathlib
import sys
project = pathlib.Path(sys.argv[1])
(project / ".pi/construct.json").write_text(json.dumps({
  "version": 1,
  "managedBy": "the-construct",
  "items": {
    "pkg": {
      "kind": "package",
      "requestedSource": "./pkg",
      "enabled": True
    }
  }
}, indent=2) + "\n")
PY
OUTPUT="$(construct_pi "$HOME_G" "$PROJECT_G" '/construct load' 2>&1)"
grep -Fq 'No project package declarations are waiting to be loaded.' <<<"$OUTPUT"
test ! -e "$HOME_G/.pi/agent/construct/catalog.json"

printf '== local-only package declaration ==\n'
HOME_E="$TMP/home-local-only"
PROJECT_E="$TMP/project-local-only"
mkdir -p "$HOME_E" "$PROJECT_E"
write_settings_with_pkg "$PROJECT_E"
OUTPUT="$(construct_pi "$HOME_E" "$PROJECT_E" '/construct' 2>&1)"
grep -Fq 'Unloaded' <<<"$OUTPUT"
grep -Fq 'construct-invalid-drift-package' <<<"$OUTPUT"
test ! -e "$PROJECT_E/.pi/construct.json"

printf 'invalid/drift smoke ok\n'
