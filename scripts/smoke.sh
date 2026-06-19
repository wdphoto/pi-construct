#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

HOME_DIR="$TMP/home"
PROJECT_DIR="$TMP/project"
PKG_DIR="$TMP/pkg"
PKG2_DIR="$TMP/pkg-two"
mkdir -p "$HOME_DIR" "$PROJECT_DIR" "$PKG_DIR/extensions" "$PKG2_DIR/extensions"

cat > "$PKG_DIR/package.json" <<'JSON'
{
  "name": "construct-fixture-pkg",
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

cat > "$PKG2_DIR/package.json" <<'JSON'
{
  "name": "construct-fixture-pkg-two",
  "version": "0.0.0",
  "type": "module",
  "pi": {
    "extensions": ["extensions/noop.ts"]
  }
}
JSON

cat > "$PKG2_DIR/extensions/noop.ts" <<'TS'
export default function noop() {}
TS

run_pi() {
  (
    cd "$PROJECT_DIR"
    HOME="$HOME_DIR" pi --no-extensions -e "$ROOT" -p "$1"
  )
}

quiet_pi() {
  run_pi "$1" >/dev/null 2>&1
}

printf '== new-project dashboard/status ==\n'
DASHBOARD_OUTPUT="$(run_pi '/construct')"
[[ "$DASHBOARD_OUTPUT" == *"Construct loadout"* ]]
[[ "$DASHBOARD_OUTPUT" == *"AVAILABLE — Construct library"* ]]
STATUS_OUTPUT="$(run_pi '/construct status')"
[[ "$STATUS_OUTPUT" == *"Construct metadata: missing:"* ]]
python3 - "$PROJECT_DIR" <<'PY'
import pathlib
import sys

project = pathlib.Path(sys.argv[1])
assert not (project / ".pi/construct.json").exists(), "status should not create Construct metadata"
PY

printf '== library sync ==\n'
mkdir -p "$PROJECT_DIR/.pi"
python3 - "$PROJECT_DIR" "$PKG_DIR" <<'PY'
import json
import pathlib
import sys

project = pathlib.Path(sys.argv[1])
source = sys.argv[2]
(project / ".pi/settings.json").write_text(json.dumps({"packages": [source]}, indent=2) + "\n")
PY
SYNC_PROMPT_OUTPUT="$(run_pi '/construct sync')"
[[ "$SYNC_PROMPT_OUTPUT" == *"Construct sync needs a selection."* ]]
quiet_pi '/construct sync -a'
python3 - "$HOME_DIR" "$PROJECT_DIR" "$PKG_DIR" <<'PY'
import json
import pathlib
import sys

home = pathlib.Path(sys.argv[1])
project = pathlib.Path(sys.argv[2])
source = str(pathlib.Path(sys.argv[3]).resolve())
catalog = json.loads((home / ".pi/agent/construct/catalog.json").read_text())
construct = json.loads((project / ".pi/construct.json").read_text())
assert any(item.get("source") == source for item in catalog.get("items", [])), catalog
assert any(item.get("source") == source and item.get("enabled") is True for item in construct.get("items", {}).values()), construct
PY

printf '== dashboard sees managed package ==\n'
DASHBOARD_OUTPUT="$(run_pi '/construct')"
[[ "$DASHBOARD_OUTPUT" == *"ON — Construct packages"* ]]
[[ "$DASHBOARD_OUTPUT" == *"construct-fixture-pkg"* || "$DASHBOARD_OUTPUT" == *"pkg"* ]]

printf '== automatic sync disabled ==\n'
python3 - "$PROJECT_DIR" "$PKG2_DIR" <<'PY'
import json
import pathlib
import sys

project = pathlib.Path(sys.argv[1])
source = sys.argv[2]
(project / ".pi/settings.json").write_text(json.dumps({"packages": [source]}, indent=2) + "\n")
PY
quiet_pi '/construct status'

python3 - "$PROJECT_DIR" "$HOME_DIR" "$PKG2_DIR" <<'PY'
import json
import pathlib
import sys

project = pathlib.Path(sys.argv[1])
home = pathlib.Path(sys.argv[2])
source = sys.argv[3]
remembered_source = str(pathlib.Path(source).resolve())
settings = json.loads((project / ".pi/settings.json").read_text())
construct = json.loads((project / ".pi/construct.json").read_text())
user_settings_path = home / ".pi/agent/construct/settings.json"
catalog = json.loads((home / ".pi/agent/construct/catalog.json").read_text())

assert settings.get("packages") == [source], settings
assert isinstance(construct.get("items"), dict), construct
assert not user_settings_path.exists(), "status/sync should not create Construct user settings"
assert not any(item.get("source") == remembered_source for item in catalog.get("items", [])), catalog
PY

printf '== removed command surface ==\n'
UNKNOWN_OUTPUT="$(run_pi '/construct load whatever')"
[[ "$UNKNOWN_OUTPUT" == *"Unknown /construct subcommand: load"* ]]
[[ "$UNKNOWN_OUTPUT" == *"/construct sync [-a]"* ]]

printf 'smoke ok\n'
