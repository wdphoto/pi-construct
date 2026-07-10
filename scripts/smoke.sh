#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

HOME_DIR="$TMP/home"
PROJECT_DIR="$TMP/project"
PKG_DIR="$TMP/pkg"
PKG2_DIR="$TMP/pkg-two"
SCAN_PROJECT_DIR="$TMP/scan-project"
mkdir -p "$HOME_DIR" "$PROJECT_DIR" "$PKG_DIR/extensions" "$PKG_DIR/skills/helper" "$PKG_DIR/prompts" "$PKG_DIR/themes" "$PKG2_DIR/extensions" "$SCAN_PROJECT_DIR/.pi/skills/helper" "$SCAN_PROJECT_DIR/.pi/prompts" "$SCAN_PROJECT_DIR/.pi/themes" "$SCAN_PROJECT_DIR/.pi/extensions/tool" "$SCAN_PROJECT_DIR/.agents/skills/agent-helper"

cat > "$PKG_DIR/package.json" <<'JSON'
{
  "name": "construct-fixture-pkg",
  "version": "0.0.0",
  "type": "module",
  "pi": {
    "extensions": ["extensions/noop.ts"],
    "skills": ["skills/helper/SKILL.md"],
    "prompts": ["prompts/review.md"],
    "themes": ["themes/simple.json"]
  }
}
JSON

cat > "$PKG_DIR/extensions/noop.ts" <<'TS'
export default function noop() {}
TS
cat > "$PKG_DIR/skills/helper/SKILL.md" <<'MD'
---
name: package-helper
description: Helps package resource smoke tests.
---
# Package Helper
MD
cat > "$PKG_DIR/prompts/review.md" <<'MD'
Review this package resource.
MD
cat > "$PKG_DIR/themes/simple.json" <<'JSON'
{
  "name": "package-simple"
}
JSON

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

cat > "$SCAN_PROJECT_DIR/.pi/settings.json" <<JSON
{
  "packages": ["$PKG2_DIR"]
}
JSON
cat > "$SCAN_PROJECT_DIR/.pi/skills/helper/SKILL.md" <<'MD'
---
name: helper
description: Helps scan smoke tests.
---
# Helper
MD
cat > "$SCAN_PROJECT_DIR/.agents/skills/agent-helper/SKILL.md" <<'MD'
---
name: agent-helper
description: Exercises Pi-resolved project .agents skill discovery.
---
# Agent Helper
MD
cat > "$SCAN_PROJECT_DIR/.pi/prompts/review.md" <<'MD'
Review this.
MD
cat > "$SCAN_PROJECT_DIR/.pi/themes/simple.json" <<'JSON'
{
  "name": "simple"
}
JSON
cat > "$SCAN_PROJECT_DIR/.pi/extensions/tool/index.ts" <<'TS'
export default function tool() {}
TS
python3 - "$HOME_DIR" "$SCAN_PROJECT_DIR" <<'PY'
import json
import pathlib
import sys

home = pathlib.Path(sys.argv[1])
project = pathlib.Path(sys.argv[2]).resolve()
trust_path = home / ".pi/agent/trust.json"
trust_path.parent.mkdir(parents=True, exist_ok=True)
trust_path.write_text(json.dumps({str(project): True}, indent=2) + "\n")
PY

run_pi_in() {
  local dir="$1"
  local prompt="$2"
  (
    cd "$dir"
    HOME="$HOME_DIR" pi --no-extensions -e "$ROOT" -p "$prompt"
  )
}

run_pi() {
  run_pi_in "$PROJECT_DIR" "$1"
}

run_pi_approved() {
  local prompt="$1"
  (
    cd "$PROJECT_DIR"
    HOME="$HOME_DIR" pi --no-extensions -e "$ROOT" --approve -p "$prompt"
  )
}

quiet_pi() {
  run_pi "$1" >/dev/null 2>&1
}

printf '== new-project dashboard/status ==\n'
DASHBOARD_OUTPUT="$(run_pi '/construct')"
[[ "$DASHBOARD_OUTPUT" == *"pi-construct@"* ]]
[[ "$DASHBOARD_OUTPUT" == *"Active"* ]]
[[ "$DASHBOARD_OUTPUT" == *"Unloaded"* ]]
[[ "$DASHBOARD_OUTPUT" == *"No Construct metadata yet"* ]]
[[ "$DASHBOARD_OUTPUT" == *"→ unfolds known package resources"* ]]
[[ "$DASHBOARD_OUTPUT" != *"inspects/unfolds"* ]]
STATUS_OUTPUT="$(run_pi '/construct status')"
[[ "$STATUS_OUTPUT" == *"Construct metadata: missing"* ]]
STATUS_FULL_OUTPUT="$(run_pi '/construct status full')"
[[ "$STATUS_FULL_OUTPUT" == *"Runtime inventory"* ]]
[[ "$STATUS_FULL_OUTPUT" == *"Tool sources:"* ]]
[[ "$STATUS_FULL_OUTPUT" == *"Active tool sources:"* ]]
python3 - "$PROJECT_DIR" <<'PY'
import pathlib
import sys

project = pathlib.Path(sys.argv[1])
assert not (project / ".pi/construct.json").exists(), "status should not create Construct metadata"
PY

printf '== library load ==\n'
mkdir -p "$PROJECT_DIR/.pi"
python3 - "$PROJECT_DIR" "$PKG_DIR" <<'PY'
import json
import pathlib
import sys

project = pathlib.Path(sys.argv[1])
source = sys.argv[2]
(project / ".pi/settings.json").write_text(json.dumps({"packages": [source]}, indent=2) + "\n")
PY
LOAD_OUTPUT="$(run_pi_approved '/construct load')"
[[ "$LOAD_OUTPUT" == *"Construct load complete."* ]]
[[ "$LOAD_OUTPUT" == *"Added to Construct: 1"* ]]
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
[[ "$DASHBOARD_OUTPUT" == *"Active"* ]]
[[ "$DASHBOARD_OUTPUT" == *"construct-fixture-pkg"* || "$DASHBOARD_OUTPUT" == *"pkg"* ]]
[[ "$DASHBOARD_OUTPUT" == *"→ unfolds known package resources"* ]]
[[ "$DASHBOARD_OUTPUT" != *"inspects/unfolds"* ]]
STATUS_FULL_OUTPUT="$(run_pi_approved '/construct status full')"
[[ "$STATUS_FULL_OUTPUT" == *"Package-contained resources: 4 (project packages only)"* ]]
[[ "$STATUS_FULL_OUTPUT" == *"extensions: 1"* ]]
[[ "$STATUS_FULL_OUTPUT" == *"skills: 1"* ]]
[[ "$STATUS_FULL_OUTPUT" == *"prompts: 1"* ]]
[[ "$STATUS_FULL_OUTPUT" == *"themes: 1"* ]]
[[ "$STATUS_FULL_OUTPUT" == *"skill helper (enabled)"* ]]
[[ "$STATUS_FULL_OUTPUT" == *"skills/helper/SKILL.md"* ]]
SAVE_OUTPUT="$(run_pi_approved '/construct save baseline')"
[[ "$SAVE_OUTPUT" == *"Saved loadout: baseline"* ]]
RUN_ACTIVE_OUTPUT="$(run_pi_approved '/construct run baseline')"
[[ "$RUN_ACTIVE_OUTPUT" == *"Saved loadout already active: baseline"* ]]
[[ "$RUN_ACTIVE_OUTPUT" == *"No package settings changed."* ]]

printf '== disabled package filters are recognized ==\n'
python3 - "$PROJECT_DIR" "$PKG_DIR" <<'PY'
import json
import pathlib
import sys

project = pathlib.Path(sys.argv[1])
source = sys.argv[2]
(project / ".pi/settings.json").write_text(json.dumps({"packages": [{
    "source": source,
    "extensions": [],
    "skills": [],
    "prompts": [],
    "themes": [],
}]}, indent=2) + "\n")
PY
DASHBOARD_OUTPUT="$(run_pi '/construct')"
[[ "$DASHBOARD_OUTPUT" == *"0 active · 1 disabled"* ]]
[[ "$DASHBOARD_OUTPUT" == *"– Disabled"* ]]
[[ "$DASHBOARD_OUTPUT" == *"pkg"* || "$DASHBOARD_OUTPUT" == *"construct-fixture-pkg"* ]]
STATUS_OUTPUT="$(run_pi '/construct status')"
[[ "$STATUS_OUTPUT" == *"enabled in Construct metadata, disabled by package filters"* ]]
RUN_ENABLE_OUTPUT="$(run_pi_approved '/construct run baseline')"
[[ "$RUN_ENABLE_OUTPUT" == *"Ran saved loadout: baseline"* ]]
[[ "$RUN_ENABLE_OUTPUT" == *"Enabled: 1"* ]]

printf '== partial package filters are recognized ==\n'
python3 - "$PROJECT_DIR" "$PKG_DIR" <<'PY'
import json
import pathlib
import sys

project = pathlib.Path(sys.argv[1])
source = sys.argv[2]
(project / ".pi/settings.json").write_text(json.dumps({"packages": [{
    "source": source,
    "skills": ["skills/helper/SKILL.md"],
}]}, indent=2) + "\n")
PY
STATUS_FULL_OUTPUT="$(run_pi_approved '/construct status full')"
[[ "$STATUS_FULL_OUTPUT" == *"partially filtered (skills 1)"* ]]
[[ "$STATUS_FULL_OUTPUT" == *"Package-contained resources: 4 (project packages only)"* ]]

printf '== no implicit adoption ==\n'
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
assert not user_settings_path.exists(), "status/load should not create Construct user settings"
assert not any(item.get("source") == remembered_source for item in catalog.get("items", [])), catalog
PY

printf '== autoload is not public ==\n'
AUTOLOAD_OUTPUT="$(run_pi '/construct autoload status')"
[[ "$AUTOLOAD_OUTPUT" == *"Unknown /construct subcommand: autoload"* ]]
[[ "$AUTOLOAD_OUTPUT" != *"Construct autoload:"* ]]
STATUS_OUTPUT="$(run_pi '/construct status')"
[[ "$STATUS_OUTPUT" != *"Autoload:"* ]]

printf '== saved loadout list ==\n'
LIST_OUTPUT="$(run_pi '/construct list')"
[[ "$LIST_OUTPUT" == *"Saved Construct loadouts"* ]]
UNLOAD_EQUIV_OUTPUT="$(run_pi "/construct unload $PKG_DIR/")"
[[ "$UNLOAD_EQUIV_OUTPUT" == *"Construct unload complete."* ]]
[[ "$UNLOAD_EQUIV_OUTPUT" == *"Construct forgot: 1 resource"* ]]
python3 - "$HOME_DIR" <<'PY'
import json
import pathlib
import sys

home = pathlib.Path(sys.argv[1])
catalog = json.loads((home / ".pi/agent/construct/catalog.json").read_text())
assert not catalog.get("items"), catalog
baseline = next(profile for profile in catalog.get("profiles", []) if profile.get("id") == "baseline")
assert baseline.get("sources") == [], baseline
PY

printf '== stale known-project visibility ==\n'
python3 - "$HOME_DIR" "$TMP/missing-project" <<'PY'
import json
import pathlib
import sys

home = pathlib.Path(sys.argv[1])
missing = pathlib.Path(sys.argv[2])
projects_path = home / ".pi/agent/construct/projects.json"
projects_path.parent.mkdir(parents=True, exist_ok=True)
try:
    data = json.loads(projects_path.read_text())
except FileNotFoundError:
    data = {"version": 1, "projects": []}
data.setdefault("projects", []).append({
    "path": str(missing),
    "realPath": str(missing),
    "packages": ["npm:missing-fixture"],
    "updatedAt": "2026-06-22T00:00:00.000Z",
})
projects_path.write_text(json.dumps(data, indent=2) + "\n")
PY
STATUS_FULL_OUTPUT="$(run_pi '/construct status full')"
[[ "$STATUS_FULL_OUTPUT" == *"Known-project missing paths: 1 (not pruned automatically)"* ]]
[[ "$STATUS_FULL_OUTPUT" == *"Missing known project:"* ]]

printf '== project scan ==\n'
SCAN_TRUST_OUTPUT="$(run_pi '/construct scan')"
[[ "$SCAN_TRUST_OUTPUT" == *"Construct scan"* ]]
[[ "$SCAN_TRUST_OUTPUT" == *"Source: Pi trust store"* ]]
[[ "$SCAN_TRUST_OUTPUT" == *"Trusted projects scanned: 1"* ]]
[[ "$SCAN_TRUST_OUTPUT" == *"scan-project"* ]]
SCAN_OUTPUT="$(run_pi "/construct scan $TMP")"
[[ "$SCAN_OUTPUT" == *"Construct scan"* ]]
[[ "$SCAN_OUTPUT" == *"Trusted projects scanned: 1"* ]]
[[ "$SCAN_OUTPUT" == *"Skipped untrusted projects: 1"* ]]
[[ "$SCAN_OUTPUT" == *"scan-project"* ]]
[[ "$SCAN_OUTPUT" == *"Unloaded package declarations:"* ]]
[[ "$SCAN_OUTPUT" == *"package $PKG2_DIR"* ]]
[[ "$SCAN_OUTPUT" == *"skill helper"* ]]
[[ "$SCAN_OUTPUT" == *"skill agent-helper"* ]]
[[ "$SCAN_OUTPUT" == *"prompt review"* ]]
[[ "$SCAN_OUTPUT" == *"theme simple"* ]]
[[ "$SCAN_OUTPUT" == *"extension tool"* ]]
[[ "$SCAN_OUTPUT" == *"not trusted by Pi"* ]]
[[ "$SCAN_OUTPUT" == *"No files were changed."* ]]
SCAN_LOAD_OUTPUT="$(run_pi_in "$SCAN_PROJECT_DIR" '/construct load')"
[[ "$SCAN_LOAD_OUTPUT" == *"Construct load complete."* ]]
[[ "$SCAN_LOAD_OUTPUT" == *"Project items armed:"* ]]
[[ "$SCAN_LOAD_OUTPUT" == *"Direct project resources adopted:"* ]]
SCAN_AFTER_LOAD_OUTPUT="$(run_pi "/construct scan $TMP")"
[[ "$SCAN_AFTER_LOAD_OUTPUT" == *"No unloaded resources found."* ]]
[[ "$SCAN_AFTER_LOAD_OUTPUT" != *"package $PKG2_DIR"* ]]
[[ "$SCAN_AFTER_LOAD_OUTPUT" != *"skill helper"* ]]
[[ "$SCAN_AFTER_LOAD_OUTPUT" != *"skill agent-helper"* ]]
[[ "$SCAN_AFTER_LOAD_OUTPUT" != *"prompt review"* ]]
[[ "$SCAN_AFTER_LOAD_OUTPUT" != *"theme simple"* ]]
[[ "$SCAN_AFTER_LOAD_OUTPUT" != *"extension tool"* ]]
rm -rf "$SCAN_PROJECT_DIR/.agents/skills/agent-helper"
SCAN_DRIFT_OUTPUT="$(run_pi "/construct scan $TMP")"
[[ "$SCAN_DRIFT_OUTPUT" == *"direct resource missing from Pi's resolved project resources"* ]]
[[ "$SCAN_DRIFT_OUTPUT" == *"agent-helper"* ]]

printf '== Pi project overrides stay read-only ==\n'
python3 - "$PROJECT_DIR" "$HOME_DIR" "$PKG_DIR" <<'PY'
import json
import pathlib
import sys

project = pathlib.Path(sys.argv[1])
home = pathlib.Path(sys.argv[2])
source = str(pathlib.Path(sys.argv[3]).resolve())
(project / ".pi/settings.json").write_text(json.dumps({"packages": [{
    "source": source,
    "autoload": False,
    "skills": ["-skills/helper/SKILL.md"],
}]}, indent=2) + "\n")
catalog_path = home / ".pi/agent/construct/catalog.json"
catalog = json.loads(catalog_path.read_text())
catalog.setdefault("profiles", []).append({
    "id": "override-recipe",
    "kind": "profile",
    "items": [],
    "sources": [source],
})
catalog_path.write_text(json.dumps(catalog, indent=2) + "\n")
PY
OVERRIDE_DASHBOARD_OUTPUT="$(run_pi '/construct')"
[[ "$OVERRIDE_DASHBOARD_OUTPUT" == *"Overrides"* ]]
[[ "$OVERRIDE_DASHBOARD_OUTPUT" == *"↔"* ]]
[[ "$OVERRIDE_DASHBOARD_OUTPUT" == *"pi config -l"* ]]
OVERRIDE_STATUS_OUTPUT="$(run_pi_approved '/construct status full')"
[[ "$OVERRIDE_STATUS_OUTPUT" == *"Pi project overrides: 1"* ]]
OVERRIDE_LOAD_OUTPUT="$(run_pi_approved "/construct load $PKG_DIR")"
[[ "$OVERRIDE_LOAD_OUTPUT" == *"autoload: false"* ]]
[[ "$OVERRIDE_LOAD_OUTPUT" == *"pi config -l"* ]]
OVERRIDE_RUN_OUTPUT="$(run_pi_approved '/construct run override-recipe')"
[[ "$OVERRIDE_RUN_OUTPUT" == *"Pi project overrides skipped: 1"* ]]
[[ "$OVERRIDE_RUN_OUTPUT" == *"No package settings changed."* ]]

printf '== removed command surface ==\n'
UNKNOWN_OUTPUT="$(run_pi '/construct sync')"
[[ "$UNKNOWN_OUTPUT" == *"Unknown /construct subcommand: sync"* ]]
[[ "$UNKNOWN_OUTPUT" == *"/construct scan [path]"* ]]
[[ "$UNKNOWN_OUTPUT" == *"/construct load"* ]]
[[ "$UNKNOWN_OUTPUT" == *"/construct unload"* ]]
[[ "$UNKNOWN_OUTPUT" == *"/construct list"* ]]
[[ "$UNKNOWN_OUTPUT" == *"/construct share <saved-name>"* ]]
[[ "$UNKNOWN_OUTPUT" == *"/construct wipe <saved-name>"* ]]
RELOAD_OUTPUT="$(run_pi '/construct reload')"
[[ "$RELOAD_OUTPUT" == *"Unknown /construct subcommand: reload"* ]]
COPY_OUTPUT="$(run_pi '/construct copy')"
[[ "$COPY_OUTPUT" == *"Unknown /construct subcommand: copy"* ]]
PROFILE_OUTPUT="$(run_pi '/construct profile list')"
[[ "$PROFILE_OUTPUT" == *"Unknown /construct subcommand: profile"* ]]
SAVED_OUTPUT="$(run_pi '/construct saved')"
[[ "$SAVED_OUTPUT" == *"Unknown /construct subcommand: saved"* ]]
RUN_OUTPUT="$(run_pi '/construct run')"
[[ "$RUN_OUTPUT" == *"Usage: /construct run <saved-name>"* ]]
SHARE_OUTPUT="$(run_pi '/construct share')"
[[ "$SHARE_OUTPUT" == *"Usage: /construct share <saved-name>"* ]]
REMOVE_OUTPUT="$(run_pi '/construct remove')"
[[ "$REMOVE_OUTPUT" == *"Unknown /construct subcommand: remove"* ]]
WIPE_OUTPUT="$(run_pi '/construct wipe')"
[[ "$WIPE_OUTPUT" == *"Usage: /construct wipe <saved-name>"* ]]
DASHBOARD_ALIAS_OUTPUT="$(run_pi '/construct dashboard')"
[[ "$DASHBOARD_ALIAS_OUTPUT" == *"Unknown /construct subcommand: dashboard"* ]]

printf 'smoke ok\n'
