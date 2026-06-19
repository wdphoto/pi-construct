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

printf '== catalog ==\n'
quiet_pi '/construct catalog'
quiet_pi '/construct catalog add npm:@scope/pkg browser-tools'
quiet_pi '/construct load --dry-run browser-tools'
python3 - "$HOME_DIR" <<'PY'
import json
import pathlib
import sys

home = pathlib.Path(sys.argv[1])
catalog_path = home / ".pi/agent/construct/catalog.json"
catalog = json.loads(catalog_path.read_text())
catalog["items"].append({
    "id": "grouped-tools",
    "kind": "package",
    "source": "npm:@scope/grouped-tools",
    "groups": ["review"],
    "customField": {"kept": True},
})
catalog_path.write_text(json.dumps(catalog, indent=2) + "\n")
PY
quiet_pi '/construct catalog add npm:@scope/other other-tools'
quiet_pi '/construct catalog remove other-tools'
python3 - "$HOME_DIR" <<'PY'
import json
import pathlib
import sys

home = pathlib.Path(sys.argv[1])
catalog = json.loads((home / ".pi/agent/construct/catalog.json").read_text())
item = next(item for item in catalog["items"] if item["id"] == "grouped-tools")
assert item.get("groups") == ["review"], item
assert item.get("customField") == {"kept": True}, item
PY
quiet_pi '/construct catalog remove browser-tools'
quiet_pi '/construct catalog remove grouped-tools'

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
python3 - "$HOME_DIR" "$PKG_DIR" <<'PY'
import json
import pathlib
import sys

home = pathlib.Path(sys.argv[1])
source = str(pathlib.Path(sys.argv[2]).resolve())
catalog = json.loads((home / ".pi/agent/construct/catalog.json").read_text())
assert any(item.get("source") == source for item in catalog.get("items", [])), catalog
PY

printf '== construct toggle managed project packages off ==\n'
quiet_pi '/construct toggle'
python3 - "$PROJECT_DIR" <<'PY'
import json
import pathlib
import sys

project = pathlib.Path(sys.argv[1])
settings = json.loads((project / ".pi/settings.json").read_text())
assert settings.get("packages") == [], settings
assert list((project / ".pi").glob("settings.json.bak.*")), "expected settings backup files"
PY

printf '== load / unload / disable / enable / remove ==\n'
quiet_pi "/construct load $PKG_DIR"
quiet_pi '/construct unload pkg'
quiet_pi '/construct load pkg'
quiet_pi '/construct disable pkg'
quiet_pi '/construct enable pkg'
quiet_pi '/construct remove pkg'

printf '== sync commands ==\n'
quiet_pi '/construct sync'
quiet_pi '/construct sync -a'
quiet_pi '/construct sync status'
quiet_pi '/construct sync current'
quiet_pi '/construct sync project'

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
assert list((project / ".pi").glob("settings.json.bak.*")), "expected settings backup files"
PY

printf 'smoke ok\n'
