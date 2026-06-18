#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

HOME_DIR="$TMP/home"
PROJECT_A="$TMP/project-a"
PROJECT_B="$TMP/project-b"
PKG_DIR="$TMP/construct-e2e-package"
mkdir -p "$HOME_DIR" "$PROJECT_A" "$PROJECT_B" "$PKG_DIR/extensions"

cat > "$PKG_DIR/package.json" <<'JSON'
{
  "name": "construct-e2e-package",
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
  local project="$1"
  local prompt="$2"
  (
    cd "$project"
    HOME="$HOME_DIR" pi --no-extensions -e "$ROOT" -p "$prompt"
  )
}

quiet_construct_pi() {
  construct_pi "$1" "$2" >/dev/null 2>&1
}

printf '== project A raw local pi install ==\n'
(
  cd "$PROJECT_A"
  HOME="$HOME_DIR" pi install "$PKG_DIR" -l --approve >/dev/null 2>&1
)

python3 - "$PROJECT_A" "$PKG_DIR" <<'PY'
import json
import pathlib
import sys

project = pathlib.Path(sys.argv[1])
source = pathlib.Path(sys.argv[2]).resolve()
settings = json.loads((project / ".pi/settings.json").read_text())
packages = settings.get("packages")
assert isinstance(packages, list) and len(packages) == 1, settings
entry = pathlib.Path(packages[0])
resolved = entry if entry.is_absolute() else (project / ".pi" / entry).resolve()
assert resolved == source, settings
PY

printf '== project A construct sync remembers raw install ==\n'
SYNC_OUTPUT="$(construct_pi "$PROJECT_A" '/construct sync' 2>&1)"
grep -Fq 'Local package installs remembered from this project:' <<<"$SYNC_OUTPUT"
grep -Fq 'construct-e2e-package:' <<<"$SYNC_OUTPUT"
grep -Fq "$(python3 -c 'import pathlib, sys; print(pathlib.Path(sys.argv[1]).resolve())' "$PKG_DIR")" <<<"$SYNC_OUTPUT"

python3 - "$HOME_DIR" "$PKG_DIR" <<'PY'
import json
import pathlib
import sys

home = pathlib.Path(sys.argv[1])
source = str(pathlib.Path(sys.argv[2]).resolve())
catalog = json.loads((home / ".pi/agent/construct/catalog.json").read_text())
assert any(item.get("id") == "construct-e2e-package" and item.get("source") == source for item in catalog.get("items", [])), catalog
PY

printf '== project B construct load remembered package ==\n'
quiet_construct_pi "$PROJECT_B" '/construct load construct-e2e-package'
quiet_construct_pi "$PROJECT_B" '/construct reload'

python3 - "$PROJECT_B" "$PKG_DIR" <<'PY'
import json
import pathlib
import sys

project = pathlib.Path(sys.argv[1])
source = pathlib.Path(sys.argv[2]).resolve()
settings = json.loads((project / ".pi/settings.json").read_text())
construct = json.loads((project / ".pi/construct.json").read_text())
packages = settings.get("packages")
assert isinstance(packages, list) and len(packages) == 1, settings
entry = pathlib.Path(packages[0])
resolved = entry if entry.is_absolute() else (project / ".pi" / entry).resolve()
assert resolved == source, settings
items = construct.get("items", {})
assert any(
    ((pathlib.Path(item.get("source", "")) if pathlib.Path(item.get("source", "")).is_absolute() else (project / ".pi" / item.get("source", "")).resolve()) == source
     or item.get("requestedSource") == str(source))
    and item.get("enabled") is True
    for item in items.values()
), construct
# No settings backup is expected on first load because .pi/settings.json did not exist yet.
PY

printf '== project B construct unload one by id ==\n'
quiet_construct_pi "$PROJECT_B" '/construct unload construct-e2e-package'
quiet_construct_pi "$PROJECT_B" '/construct reload'

python3 - "$PROJECT_B" "$PKG_DIR" <<'PY'
import json
import pathlib
import sys

project = pathlib.Path(sys.argv[1])
source = pathlib.Path(sys.argv[2]).resolve()
settings = json.loads((project / ".pi/settings.json").read_text())
construct = json.loads((project / ".pi/construct.json").read_text())
assert settings.get("packages") == [], settings
items = construct.get("items", {})
assert any(item.get("requestedSource") == str(source) and item.get("enabled") is False for item in items.values()), construct
assert list((project / ".pi").glob("settings.json.bak.*")), "expected settings backup after single unload"
PY

printf '== project B construct reload remembered package ==\n'
quiet_construct_pi "$PROJECT_B" '/construct load construct-e2e-package'
quiet_construct_pi "$PROJECT_B" '/construct reload'

printf '== project B construct wipe all ==\n'
quiet_construct_pi "$PROJECT_B" '/construct wipe'
quiet_construct_pi "$PROJECT_B" '/construct reload'

python3 - "$PROJECT_B" "$PKG_DIR" <<'PY'
import json
import pathlib
import sys

project = pathlib.Path(sys.argv[1])
source = pathlib.Path(sys.argv[2]).resolve()
settings = json.loads((project / ".pi/settings.json").read_text())
construct = json.loads((project / ".pi/construct.json").read_text())
assert settings.get("packages") == [], settings
items = construct.get("items", {})
assert any(item.get("requestedSource") == str(source) and item.get("enabled") is False for item in items.values()), construct
assert list((project / ".pi").glob("settings.json.bak.*")), "expected settings backup after unload"
PY

printf 'e2e smoke ok\n'
