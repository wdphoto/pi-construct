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
SYNC_MENU_OUTPUT="$(construct_pi "$PROJECT_A" '/construct sync' 2>&1)"
grep -Fq 'Construct sync needs a selection.' <<<"$SYNC_MENU_OUTPUT"
SYNC_OUTPUT="$(construct_pi "$PROJECT_A" '/construct sync auto' 2>&1)"
grep -Fq 'Construct sync complete.' <<<"$SYNC_OUTPUT"
grep -Fq 'Added to Construct: 1' <<<"$SYNC_OUTPUT"
grep -Fq 'Errors: 0' <<<"$SYNC_OUTPUT"
grep -Fq 'No /reload needed' <<<"$SYNC_OUTPUT"

python3 - "$HOME_DIR" "$PROJECT_A" "$PKG_DIR" <<'PY'
import json
import pathlib
import sys

home = pathlib.Path(sys.argv[1])
project = pathlib.Path(sys.argv[2])
source = str(pathlib.Path(sys.argv[3]).resolve())
catalog = json.loads((home / ".pi/agent/construct/catalog.json").read_text())
construct = json.loads((project / ".pi/construct.json").read_text())
assert any(item.get("id") == "construct-e2e-package" and item.get("source") == source for item in catalog.get("items", [])), catalog
assert any(item.get("source") == source and item.get("enabled") is True for item in construct.get("items", {}).values()), construct
PY

printf '== project B dashboard shows remembered package as available ==\n'
DASHBOARD_OUTPUT="$(construct_pi "$PROJECT_B" '/construct' 2>&1)"
grep -Fq 'Available' <<<"$DASHBOARD_OUTPUT"
grep -Fq 'construct-e2e-package' <<<"$DASHBOARD_OUTPUT"
test ! -e "$PROJECT_B/.pi/construct.json"

printf '== save and apply profile ==\n'
SAVE_PROFILE_OUTPUT="$(construct_pi "$PROJECT_A" '/construct profile save pi-projects' 2>&1)"
grep -Fq 'Construct profile saved: pi-projects' <<<"$SAVE_PROFILE_OUTPUT"
PROFILE_LIST_OUTPUT="$(construct_pi "$PROJECT_A" '/construct profile list' 2>&1)"
grep -Fq 'pi-projects' <<<"$PROFILE_LIST_OUTPUT"
APPLY_PROFILE_OUTPUT="$(construct_pi "$PROJECT_B" '/construct profile apply pi-projects' 2>&1)"
grep -Fq 'Construct profile applied: pi-projects' <<<"$APPLY_PROFILE_OUTPUT"
grep -Fq 'Turned on: 1/1' <<<"$APPLY_PROFILE_OUTPUT"
python3 - "$HOME_DIR" "$PROJECT_B" "$PKG_DIR" <<'PY'
import json
import pathlib
import sys

home = pathlib.Path(sys.argv[1])
project = pathlib.Path(sys.argv[2])
source = str(pathlib.Path(sys.argv[3]).resolve())
catalog = json.loads((home / ".pi/agent/construct/catalog.json").read_text())
settings = json.loads((project / ".pi/settings.json").read_text())
construct = json.loads((project / ".pi/construct.json").read_text())
assert any(profile.get("id") == "pi-projects" and source in profile.get("sources", []) for profile in catalog.get("profiles", [])), catalog
assert any(str((pathlib.Path(entry) if pathlib.Path(entry).is_absolute() else project / ".pi" / entry).resolve()) == source for entry in settings.get("packages", [])), settings
assert any((item.get("source") == source or item.get("requestedSource") == source) and item.get("enabled") is True for item in construct.get("items", {}).values()), construct
PY

printf '== removed load/unload command surface ==\n'
LOAD_OUTPUT="$(construct_pi "$PROJECT_B" '/construct load construct-e2e-package' 2>&1)"
grep -Fq 'Unknown /construct subcommand: load' <<<"$LOAD_OUTPUT"
UNLOAD_OUTPUT="$(construct_pi "$PROJECT_B" '/construct unload construct-e2e-package' 2>&1)"
grep -Fq 'Unknown /construct subcommand: unload' <<<"$UNLOAD_OUTPUT"

printf '== reload command remains available ==\n'
quiet_construct_pi "$PROJECT_B" '/construct reload'

printf 'e2e smoke ok\n'
