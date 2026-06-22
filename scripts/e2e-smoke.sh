#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

HOME_DIR="$TMP/home"
PROJECT_A="$TMP/project-a"
PROJECT_B="$TMP/project-b"
PROJECT_RES="$TMP/project-resources"
PKG_DIR="$TMP/construct-e2e-package"
mkdir -p "$HOME_DIR" "$PROJECT_A" "$PROJECT_B" "$PROJECT_RES" "$PKG_DIR/extensions"

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

trusted_construct_pi() {
  local project="$1"
  local prompt="$2"
  (
    cd "$project"
    HOME="$HOME_DIR" pi --no-extensions --approve -e "$ROOT" -p "$prompt"
  )
}

quiet_construct_pi() {
  construct_pi "$1" "$2" >/dev/null 2>&1
}

printf '== direct project resource load adopts metadata only ==\n'
mkdir -p "$PROJECT_RES/.pi/skills/review" "$PROJECT_RES/.pi/prompts" "$PROJECT_RES/.pi/themes" "$PROJECT_RES/.pi/extensions"
cat > "$PROJECT_RES/.pi/skills/review/SKILL.md" <<'MD'
---
description: Review helper
---
# Review
MD
cat > "$PROJECT_RES/.pi/prompts/pr-review.md" <<'MD'
# PR Review
MD
cat > "$PROJECT_RES/.pi/themes/tokyo.json" <<'JSON'
{"name":"tokyo"}
JSON
cat > "$PROJECT_RES/.pi/extensions/guard.ts" <<'TS'
export default function guard() {}
TS
RESOURCE_DASHBOARD_BEFORE="$(trusted_construct_pi "$PROJECT_RES" '/construct' 2>&1)"
grep -Fq '0 active · 0 disabled · 0 available · 4 unloaded' <<<"$RESOURCE_DASHBOARD_BEFORE"
grep -Fq 'skill:review' <<<"$RESOURCE_DASHBOARD_BEFORE"
RESOURCE_LOAD_OUTPUT="$(trusted_construct_pi "$PROJECT_RES" '/construct load' 2>&1)"
grep -Fq 'Construct load complete.' <<<"$RESOURCE_LOAD_OUTPUT"
grep -Fq 'Added to Construct: 0' <<<"$RESOURCE_LOAD_OUTPUT"
grep -Fq 'Direct project resources adopted: 4' <<<"$RESOURCE_LOAD_OUTPUT"
RESOURCE_DASHBOARD_AFTER="$(trusted_construct_pi "$PROJECT_RES" '/construct' 2>&1)"
grep -Fq '4 active · 0 disabled · 0 available · 0 unloaded' <<<"$RESOURCE_DASHBOARD_AFTER"
grep -Fq 'extension:guard' <<<"$RESOURCE_DASHBOARD_AFTER"
grep -Fq 'skill:review' <<<"$RESOURCE_DASHBOARD_AFTER"
python3 - "$HOME_DIR" "$PROJECT_RES" <<'PY'
import json
import pathlib
import sys
home = pathlib.Path(sys.argv[1])
project = pathlib.Path(sys.argv[2])
construct = json.loads((project / ".pi/construct.json").read_text())
items = list(construct.get("items", {}).values())
assert sorted(item.get("kind") for item in items) == ["extension", "prompt", "skill", "theme"], construct
assert all(str(item.get("path", "")).startswith(".pi/") for item in items), construct
catalog_path = home / ".pi/agent/construct/catalog.json"
if catalog_path.exists():
    catalog = json.loads(catalog_path.read_text())
    assert catalog.get("items", []) == [], catalog
PY
RESOURCE_SAVE_ONLY_OUTPUT="$(trusted_construct_pi "$PROJECT_RES" '/construct save direct-only' 2>&1)"
grep -Fq 'No active Construct package sources were selected' <<<"$RESOURCE_SAVE_ONLY_OUTPUT"
RESOURCE_COPY_ONLY_OUTPUT="$(trusted_construct_pi "$PROJECT_RES" '/construct copy' 2>&1)"
grep -Fq 'No active Construct package sources found' <<<"$RESOURCE_COPY_ONLY_OUTPUT"
python3 - "$HOME_DIR" <<'PY'
import json
import pathlib
import sys
catalog_path = pathlib.Path(sys.argv[1]) / ".pi/agent/construct/catalog.json"
if catalog_path.exists():
    catalog = json.loads(catalog_path.read_text())
    assert catalog.get("profiles", []) == [], catalog
PY

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

printf '== project A construct load remembers raw install ==\n'
LOAD_OUTPUT="$(construct_pi "$PROJECT_A" '/construct load' 2>&1)"
grep -Fq 'Construct load complete.' <<<"$LOAD_OUTPUT"
grep -Fq 'Added to Construct: 1' <<<"$LOAD_OUTPUT"
grep -Fq 'Errors: 0' <<<"$LOAD_OUTPUT"
grep -Fq 'No /reload needed' <<<"$LOAD_OUTPUT"

python3 - "$HOME_DIR" "$PROJECT_A" "$PKG_DIR" <<'PY'
import json
import pathlib
import sys

home = pathlib.Path(sys.argv[1])
project = pathlib.Path(sys.argv[2])
source = str(pathlib.Path(sys.argv[3]).resolve())
catalog = json.loads((home / ".pi/agent/construct/catalog.json").read_text())
construct = json.loads((project / ".pi/construct.json").read_text())
projects = json.loads((home / ".pi/agent/construct/projects.json").read_text())
assert any(item.get("id") == "construct-e2e-package" and item.get("source") == source for item in catalog.get("items", [])), catalog
assert any(item.get("source") == source and item.get("enabled") is True for item in construct.get("items", {}).values()), construct
assert any(source in project.get("packages", []) for project in projects.get("projects", [])), projects
PY

printf '== project B dashboard shows remembered package as available ==\n'
DASHBOARD_OUTPUT="$(construct_pi "$PROJECT_B" '/construct' 2>&1)"
grep -Fq 'Available' <<<"$DASHBOARD_OUTPUT"
grep -Fq 'construct-e2e-package' <<<"$DASHBOARD_OUTPUT"
test ! -e "$PROJECT_B/.pi/construct.json"

printf '== direct project resources appear in status ==\n'
mkdir -p "$PROJECT_A/.pi/skills/review" "$PROJECT_A/.pi/prompts" "$PROJECT_A/.pi/themes" "$PROJECT_A/.pi/extensions"
cat > "$PROJECT_A/.pi/skills/review/SKILL.md" <<'MD'
---
description: Review helper
---
# Review
MD
cat > "$PROJECT_A/.pi/prompts/pr-review.md" <<'MD'
# PR Review
MD
cat > "$PROJECT_A/.pi/themes/tokyo.json" <<'JSON'
{"name":"tokyo"}
JSON
cat > "$PROJECT_A/.pi/extensions/guard.ts" <<'TS'
export default function guard() {}
TS
RESOURCE_STATUS_OUTPUT="$(trusted_construct_pi "$PROJECT_A" '/construct status full' 2>&1)"
grep -Fq 'Direct project resources: 4' <<<"$RESOURCE_STATUS_OUTPUT"
grep -Fq 'extension guard (enabled, auto, unloaded' <<<"$RESOURCE_STATUS_OUTPUT"
grep -Fq '.pi/extensions/guard.ts' <<<"$RESOURCE_STATUS_OUTPUT"
grep -Fq 'skill review (enabled, auto, unloaded' <<<"$RESOURCE_STATUS_OUTPUT"
grep -Fq '.pi/skills/review/SKILL.md' <<<"$RESOURCE_STATUS_OUTPUT"
grep -Fq 'prompt pr-review (enabled, auto, unloaded' <<<"$RESOURCE_STATUS_OUTPUT"
grep -Fq '.pi/prompts/pr-review.md' <<<"$RESOURCE_STATUS_OUTPUT"
grep -Fq 'theme tokyo (enabled, auto, unloaded' <<<"$RESOURCE_STATUS_OUTPUT"
grep -Fq '.pi/themes/tokyo.json' <<<"$RESOURCE_STATUS_OUTPUT"
RESOURCE_DASHBOARD_OUTPUT="$(trusted_construct_pi "$PROJECT_A" '/construct' 2>&1)"
grep -Fq '0 available · 4 unloaded' <<<"$RESOURCE_DASHBOARD_OUTPUT"
grep -Fq 'extension:guard' <<<"$RESOURCE_DASHBOARD_OUTPUT"
grep -Fq 'skill:review' <<<"$RESOURCE_DASHBOARD_OUTPUT"
grep -Fq 'prompt:pr-review' <<<"$RESOURCE_DASHBOARD_OUTPUT"
grep -Fq 'theme:tokyo' <<<"$RESOURCE_DASHBOARD_OUTPUT"

printf '== save and run saved loadout ==\n'
SAVE_PROFILE_OUTPUT="$(construct_pi "$PROJECT_A" '/construct save pi-projects' 2>&1)"
grep -Fq 'Saved loadout: pi-projects' <<<"$SAVE_PROFILE_OUTPUT"
SAVE_AGAIN_OUTPUT="$(construct_pi "$PROJECT_A" '/construct save pi-projects' 2>&1)"
grep -Fq 'Saved loadout already exists: pi-projects' <<<"$SAVE_AGAIN_OUTPUT"
PROFILE_LIST_OUTPUT="$(construct_pi "$PROJECT_A" '/construct saved' 2>&1)"
grep -Fq 'pi-projects' <<<"$PROFILE_LIST_OUTPUT"
SAVED_DASHBOARD_OUTPUT="$(construct_pi "$PROJECT_B" '/construct' 2>&1)"
grep -Fq 'Saved' <<<"$SAVED_DASHBOARD_OUTPUT"
grep -Fq '◆  pi-projects' <<<"$SAVED_DASHBOARD_OUTPUT"
COPY_PROFILE_OUTPUT="$(construct_pi "$PROJECT_A" '/construct copy pi-projects' 2>&1)"
grep -Fq '"kind": "construct-loadout"' <<<"$COPY_PROFILE_OUTPUT"
grep -Fq '"name": "pi-projects"' <<<"$COPY_PROFILE_OUTPUT"
grep -Fq 'Local path sources may not work on another machine' <<<"$COPY_PROFILE_OUTPUT"
COPY_CURRENT_OUTPUT="$(construct_pi "$PROJECT_A" '/construct copy' 2>&1)"
grep -Fq 'Copied the current active Construct package sources only.' <<<"$COPY_CURRENT_OUTPUT"
IMPORT_JSON="{\"kind\":\"construct-loadout\",\"version\":1,\"name\":\"shared\",\"sources\":[\"$PKG_DIR\"]}"
IMPORT_PREVIEW_OUTPUT="$(construct_pi "$PROJECT_B" "/construct import $IMPORT_JSON" 2>&1)"
grep -Fq 'Construct loadout import preview' <<<"$IMPORT_PREVIEW_OUTPUT"
grep -Fq 'No files were changed. Run /construct import in TUI to confirm.' <<<"$IMPORT_PREVIEW_OUTPUT"
APPLY_PROFILE_OUTPUT="$(construct_pi "$PROJECT_B" '/construct run pi-projects' 2>&1)"
grep -Fq 'Ran saved loadout: pi-projects' <<<"$APPLY_PROFILE_OUTPUT"
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

printf '== unload removes package from Construct only ==\n'
UNLOAD_OUTPUT="$(construct_pi "$PROJECT_B" '/construct unload construct-e2e-package' 2>&1)"
grep -Fq 'Construct unload complete.' <<<"$UNLOAD_OUTPUT"
grep -Fq 'Construct forgot: 1 resource' <<<"$UNLOAD_OUTPUT"
grep -Fq 'Project package declarations were left alone in .pi/settings.json.' <<<"$UNLOAD_OUTPUT"
grep -Fq 'Still active in this project: 1 resource' <<<"$UNLOAD_OUTPUT"
grep -Fq 'Known projects for construct-e2e-package: 2' <<<"$UNLOAD_OUTPUT"
grep -Fq 'Known-project counts are informational only.' <<<"$UNLOAD_OUTPUT"
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
assert not any(item.get("source") == source for item in catalog.get("items", [])), catalog
assert not any(source in profile.get("sources", []) for profile in catalog.get("profiles", [])), catalog
assert any(str((pathlib.Path(entry) if pathlib.Path(entry).is_absolute() else project / ".pi" / entry).resolve()) == source for entry in settings.get("packages", [])), settings
assert not construct.get("items"), construct
PY

printf '== removed sync/reload command surface ==\n'
SYNC_OUTPUT="$(construct_pi "$PROJECT_B" '/construct sync' 2>&1)"
grep -Fq 'Unknown /construct subcommand: sync' <<<"$SYNC_OUTPUT"
RELOAD_OUTPUT="$(construct_pi "$PROJECT_B" '/construct reload' 2>&1)"
grep -Fq 'Unknown /construct subcommand: reload' <<<"$RELOAD_OUTPUT"

printf 'e2e smoke ok\n'
