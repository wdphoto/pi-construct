#!/usr/bin/env bash
set -euo pipefail
# Isolate even when run standalone: clear inherited agent-dir overrides that bypass $HOME.
unset PI_CODING_AGENT_DIR PI_CODING_AGENT_SESSION_DIR
export PI_OFFLINE=1

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

HOME_DIR="$TMP/home"
PROJECT_A="$TMP/project-a"
PROJECT_B="$TMP/project-b"
PROJECT_RES="$TMP/project-resources"
PROJECT_SAVE_UNLOADED="$TMP/project-save-unloaded"
PKG_DIR="$TMP/construct-e2e-package"
mkdir -p "$HOME_DIR" "$PROJECT_A" "$PROJECT_B" "$PROJECT_RES" "$PROJECT_SAVE_UNLOADED" "$PKG_DIR/extensions"

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
grep -Fq 'No active package sources were selected' <<<"$RESOURCE_SAVE_ONLY_OUTPUT"
grep -Fq 'Direct project-local resources not included: 4' <<<"$RESOURCE_SAVE_ONLY_OUTPUT"
RESOURCE_SHARE_ONLY_OUTPUT="$(trusted_construct_pi "$PROJECT_RES" '/construct share direct-only' 2>&1)"
grep -Fq 'Saved loadout not found: direct-only' <<<"$RESOURCE_SHARE_ONLY_OUTPUT"
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
LOAD_OUTPUT="$(trusted_construct_pi "$PROJECT_A" '/construct load' 2>&1)"
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
SAVE_PROFILE_OUTPUT="$(trusted_construct_pi "$PROJECT_A" '/construct save pi-projects' 2>&1)"
grep -Fq 'Saved loadout: pi-projects' <<<"$SAVE_PROFILE_OUTPUT"
SAVE_AGAIN_OUTPUT="$(trusted_construct_pi "$PROJECT_A" '/construct save pi-projects' 2>&1)"
grep -Fq 'Saved loadout already exists: pi-projects' <<<"$SAVE_AGAIN_OUTPUT"
PROFILE_LIST_OUTPUT="$(construct_pi "$PROJECT_A" '/construct list' 2>&1)"
grep -Fq 'pi-projects' <<<"$PROFILE_LIST_OUTPUT"
SAVED_DASHBOARD_OUTPUT="$(construct_pi "$PROJECT_B" '/construct' 2>&1)"
grep -Fq 'Loadouts' <<<"$SAVED_DASHBOARD_OUTPUT"
grep -Fq '◆  pi-projects' <<<"$SAVED_DASHBOARD_OUTPUT"
grep -Fq '1 available' <<<"$SAVED_DASHBOARD_OUTPUT"
SHARE_PROFILE_OUTPUT="$(construct_pi "$PROJECT_A" '/construct share pi-projects' 2>&1)"
grep -Fq 'Construct loadout share snippet' <<<"$SHARE_PROFILE_OUTPUT"
grep -Fq '"kind": "construct-loadout"' <<<"$SHARE_PROFILE_OUTPUT"
grep -Fq '"name": "pi-projects"' <<<"$SHARE_PROFILE_OUTPUT"
grep -Fq 'Local path sources may not work on another machine' <<<"$SHARE_PROFILE_OUTPUT"
SHARE_USAGE_OUTPUT="$(construct_pi "$PROJECT_A" '/construct share' 2>&1)"
grep -Fq 'Usage: /construct share <saved-name>' <<<"$SHARE_USAGE_OUTPUT"
IMPORT_JSON="{\"kind\":\"construct-loadout\",\"version\":1,\"name\":\"shared\",\"sources\":[\"$PKG_DIR\"]}"
IMPORT_PREVIEW_OUTPUT="$(construct_pi "$PROJECT_B" "/construct import $IMPORT_JSON" 2>&1)"
grep -Fq 'Construct loadout import preview' <<<"$IMPORT_PREVIEW_OUTPUT"
grep -Fq 'No files were changed. Run /construct import in TUI to confirm.' <<<"$IMPORT_PREVIEW_OUTPUT"
APPLY_PROFILE_OUTPUT="$(trusted_construct_pi "$PROJECT_B" '/construct run pi-projects' 2>&1)"
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

printf '== wipe saved loadout recipe only ==\n'
REMOVE_PROFILE_OUTPUT="$(construct_pi "$PROJECT_B" '/construct wipe pi-projects' 2>&1)"
grep -Fq 'Wiped saved loadout: pi-projects' <<<"$REMOVE_PROFILE_OUTPUT"
grep -Fq 'No project files were changed.' <<<"$REMOVE_PROFILE_OUTPUT"
PROFILE_LIST_AFTER_REMOVE="$(construct_pi "$PROJECT_B" '/construct list' 2>&1)"
! grep -Fq 'pi-projects' <<<"$PROFILE_LIST_AFTER_REMOVE"
python3 - "$HOME_DIR" "$PROJECT_B" "$PKG_DIR" <<'PY'
import json
import pathlib
import sys
home = pathlib.Path(sys.argv[1])
project = pathlib.Path(sys.argv[2])
source = str(pathlib.Path(sys.argv[3]).resolve())
catalog = json.loads((home / ".pi/agent/construct/catalog.json").read_text())
settings = json.loads((project / ".pi/settings.json").read_text())
assert any(item.get("source") == source for item in catalog.get("items", [])), catalog
assert not any(profile.get("id") == "pi-projects" for profile in catalog.get("profiles", [])), catalog
assert any(str((pathlib.Path(entry) if pathlib.Path(entry).is_absolute() else project / ".pi" / entry).resolve()) == source for entry in settings.get("packages", [])), settings
PY

printf '== unload removes package from Construct only ==\n'
UNLOAD_OUTPUT="$(trusted_construct_pi "$PROJECT_B" '/construct unload construct-e2e-package' 2>&1)"
grep -Fq 'Construct unload complete.' <<<"$UNLOAD_OUTPUT"
grep -Fq 'Construct forgot: 1 resource' <<<"$UNLOAD_OUTPUT"
grep -Fq 'Project package declarations were left alone in .pi/settings.json.' <<<"$UNLOAD_OUTPUT"
grep -Fq 'Still declared in this project: 1 (may be disabled or unresolved; shown as Unloaded in /construct).' <<<"$UNLOAD_OUTPUT"
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

printf '== save active unloaded package declarations ==\n'
(
  cd "$PROJECT_SAVE_UNLOADED"
  HOME="$HOME_DIR" pi install "$PKG_DIR" -l --approve >/dev/null 2>&1
)
SAVE_UNLOADED_OUTPUT="$(trusted_construct_pi "$PROJECT_SAVE_UNLOADED" '/construct save unloaded-package' 2>&1)"
grep -Fq 'Saved loadout: unloaded-package' <<<"$SAVE_UNLOADED_OUTPUT"
grep -Fq 'Included packages: 1' <<<"$SAVE_UNLOADED_OUTPUT"
grep -Fq 'Loaded into Construct: 1' <<<"$SAVE_UNLOADED_OUTPUT"
! grep -Fq 'Active package declarations not loaded into Construct: 0' <<<"$SAVE_UNLOADED_OUTPUT"

printf '== effective state: declared vs effective (managed and unloaded) ==\n'
MULTI_PKG="$TMP/construct-multi-package"
PROJECT_STATE="$TMP/project-state"
PROJECT_PARTIAL="$TMP/project-partial"
PROJECT_UNRESOLVED="$TMP/project-unresolved"
PROJECT_UNLOADED_ALLOFF="$TMP/project-unloaded-alloff"
PROJECT_UNLOADED_UNKNOWN="$TMP/project-unloaded-unknown"
PROJECT_WHOLE_DISABLED="$TMP/project-whole-disabled"
PROJECT_DRIFT="$TMP/project-drift"
mkdir -p "$MULTI_PKG/extensions" "$PROJECT_STATE" "$PROJECT_PARTIAL" "$PROJECT_UNRESOLVED" "$PROJECT_UNLOADED_ALLOFF" "$PROJECT_UNLOADED_UNKNOWN" "$PROJECT_WHOLE_DISABLED" "$PROJECT_DRIFT"

cat > "$MULTI_PKG/package.json" <<'JSON'
{
  "name": "construct-multi-package",
  "version": "0.0.0",
  "type": "module",
  "pi": {
    "extensions": ["extensions/alpha.ts", "extensions/beta.ts"]
  }
}
JSON
cat > "$MULTI_PKG/extensions/alpha.ts" <<'TS'
export default function alpha() {}
TS
cat > "$MULTI_PKG/extensions/beta.ts" <<'TS'
export default function beta() {}
TS

settings_hash() {
  shasum -a 256 "$1" | awk '{print $1}'
}

# Saved-loadout profiles for run command coverage (data only; sources need not exist).
python3 - "$HOME_DIR" "$MULTI_PKG" <<'PY'
import json, pathlib, sys
home = pathlib.Path(sys.argv[1])
multi = str(pathlib.Path(sys.argv[2]).resolve())
profiles = {
  "partial-active-run": multi,
  "unresolved-run": "/nonexistent/construct-unresolved-package",
  "unloaded-unknown-run": "/nonexistent/unloaded-unknown",
  "whole-disabled-run": "/nonexistent/whole-disabled",
  "override-member-run": "/nonexistent/override-member",
}
path = home / ".pi/agent/construct/catalog.json"
catalog = json.loads(path.read_text()) if path.exists() else {"version": 1, "items": [], "profiles": []}
catalog.setdefault("version", 1)
items = catalog.get("items", [])
for pid, source in profiles.items():
    items = [item for item in items if item.get("source") != source]
    items.append({"id": pid, "kind": "package", "source": source})
    catalog["profiles"] = [p for p in catalog.get("profiles", []) if p.get("id") != pid] + [{"id": pid, "kind": "profile", "items": [pid], "sources": [source]}]
catalog["items"] = items
path.parent.mkdir(parents=True, exist_ok=True)
path.write_text(json.dumps(catalog, indent=2) + "\n")
PY

# 1) Managed all-off partial: the single resolved resource is force-excluded.
(
  cd "$PROJECT_STATE"
  HOME="$HOME_DIR" pi install "$PKG_DIR" -l --approve >/dev/null 2>&1
)
trusted_construct_pi "$PROJECT_STATE" '/construct load' >/dev/null 2>&1
cp "$PROJECT_STATE/.pi/settings.json" "$PROJECT_STATE/.pi/settings.json.smoke-backup"
python3 - "$PROJECT_STATE" "$PKG_DIR" <<'PY'
import json, pathlib, sys
project = pathlib.Path(sys.argv[1])
source = str(pathlib.Path(sys.argv[2]).resolve())
settings_path = project / ".pi/settings.json"
settings = json.loads(settings_path.read_text())
settings["packages"] = [{"source": source, "extensions": ["-extensions/noop.ts"]}]
settings_path.write_text(json.dumps(settings, indent=2) + "\n")
PY
STATE_BEFORE="$(settings_hash "$PROJECT_STATE/.pi/settings.json")"
STATE_DASH="$(trusted_construct_pi "$PROJECT_STATE" '/construct' 2>&1)"
grep -Fq '1 disabled' <<<"$STATE_DASH"
if grep -Fq '1 active' <<<"$STATE_DASH"; then echo "all-off partial was reported active"; exit 1; fi
STATE_SAVE="$(trusted_construct_pi "$PROJECT_STATE" '/construct save state-partial' 2>&1)"
grep -Fq 'No active package sources were selected' <<<"$STATE_SAVE"
grep -Fq 'Packages with all resolved resources off: 1' <<<"$STATE_SAVE"
STATE_RUN="$(trusted_construct_pi "$PROJECT_STATE" '/construct run unloaded-package' 2>&1)"
grep -Fq 'Saved loadout made no changes' <<<"$STATE_RUN"
grep -Fq 'all resolved resources are off' <<<"$STATE_RUN"
if grep -Fq 'Turned on:' <<<"$STATE_RUN"; then echo "all-off partial was applied"; exit 1; fi
test "$STATE_BEFORE" = "$(settings_hash "$PROJECT_STATE/.pi/settings.json")"

# 2) Managed partly-active partial: one of two resolved resources stays enabled.
(
  cd "$PROJECT_PARTIAL"
  HOME="$HOME_DIR" pi install "$MULTI_PKG" -l --approve >/dev/null 2>&1
)
trusted_construct_pi "$PROJECT_PARTIAL" '/construct load' >/dev/null 2>&1
cp "$PROJECT_PARTIAL/.pi/settings.json" "$PROJECT_PARTIAL/.pi/settings.json.smoke-backup"
python3 - "$PROJECT_PARTIAL" "$MULTI_PKG" <<'PY'
import json, pathlib, sys
project = pathlib.Path(sys.argv[1])
source = str(pathlib.Path(sys.argv[2]).resolve())
settings_path = project / ".pi/settings.json"
settings = json.loads(settings_path.read_text())
settings["packages"] = [{"source": source, "extensions": ["-extensions/beta.ts"]}]
settings_path.write_text(json.dumps(settings, indent=2) + "\n")
PY
PARTIAL_BEFORE="$(settings_hash "$PROJECT_PARTIAL/.pi/settings.json")"
PARTIAL_DASH="$(trusted_construct_pi "$PROJECT_PARTIAL" '/construct' 2>&1)"
grep -Fq '1 active' <<<"$PARTIAL_DASH"
if grep -Fq 'all resolved resources are off' <<<"$PARTIAL_DASH"; then echo "partly-active partial was reported all-off"; exit 1; fi
PARTIAL_STATUS="$(trusted_construct_pi "$PROJECT_PARTIAL" '/construct status full' 2>&1)"
grep -Fq '1 enabled · 1 disabled' <<<"$PARTIAL_STATUS"
PARTIAL_SAVE="$(trusted_construct_pi "$PROJECT_PARTIAL" '/construct save partial-active-save' 2>&1)"
grep -Fq 'Saved loadout: partial-active-save' <<<"$PARTIAL_SAVE"
grep -Fq 'Included packages: 1' <<<"$PARTIAL_SAVE"
PARTIAL_RUN="$(trusted_construct_pi "$PROJECT_PARTIAL" '/construct run partial-active-run' 2>&1)"
grep -Fq 'Saved loadout already active' <<<"$PARTIAL_RUN"
grep -Fq 'Already active: 1/1' <<<"$PARTIAL_RUN"
test "$PARTIAL_BEFORE" = "$(settings_hash "$PROJECT_PARTIAL/.pi/settings.json")"

# 3) Managed declaration resolving nothing -> Unresolved (never Active, no install).
python3 - "$PROJECT_UNRESOLVED" <<'PY'
import json, pathlib, sys
project = pathlib.Path(sys.argv[1])
(project / ".pi").mkdir(parents=True, exist_ok=True)
source = "/nonexistent/construct-unresolved-package"
(project / ".pi/settings.json").write_text(json.dumps({"packages": [source]}, indent=2) + "\n")
(project / ".pi/construct.json").write_text(json.dumps({"version": 1, "managedBy": "the-construct", "items": {"construct-unresolved-package": {"kind": "package", "source": source, "enabled": True}}}, indent=2) + "\n")
PY
UNRESOLVED_BEFORE="$(settings_hash "$PROJECT_UNRESOLVED/.pi/settings.json")"
UNRESOLVED_DASH="$(trusted_construct_pi "$PROJECT_UNRESOLVED" '/construct' 2>&1)"
grep -Fq '1 unresolved' <<<"$UNRESOLVED_DASH"
grep -Fq 'Unresolved' <<<"$UNRESOLVED_DASH"
if grep -Fq '1 active' <<<"$UNRESOLVED_DASH"; then echo "unresolved declaration was reported active"; exit 1; fi
UNRESOLVED_SAVE="$(trusted_construct_pi "$PROJECT_UNRESOLVED" '/construct save unresolved-partial' 2>&1)"
grep -Fq 'Declared packages with no resolved resources: 1' <<<"$UNRESOLVED_SAVE"
UNRESOLVED_RUN="$(trusted_construct_pi "$PROJECT_UNRESOLVED" '/construct run unresolved-run' 2>&1)"
grep -Fq 'Unresolved declarations skipped: 1' <<<"$UNRESOLVED_RUN"
grep -Fq 'Pi resolved no package resources' <<<"$UNRESOLVED_RUN"
test "$UNRESOLVED_BEFORE" = "$(settings_hash "$PROJECT_UNRESOLVED/.pi/settings.json")"

# 4) Unloaded all-off declaration (no Construct metadata): skipped, still presented Unloaded.
(
  cd "$PROJECT_UNLOADED_ALLOFF"
  HOME="$HOME_DIR" pi install "$PKG_DIR" -l --approve >/dev/null 2>&1
)
cp "$PROJECT_UNLOADED_ALLOFF/.pi/settings.json" "$PROJECT_UNLOADED_ALLOFF/.pi/settings.json.smoke-backup"
python3 - "$PROJECT_UNLOADED_ALLOFF" "$PKG_DIR" <<'PY'
import json, pathlib, sys
project = pathlib.Path(sys.argv[1])
source = str(pathlib.Path(sys.argv[2]).resolve())
settings_path = project / ".pi/settings.json"
settings = json.loads(settings_path.read_text())
settings["packages"] = [{"source": source, "extensions": ["-extensions/noop.ts"]}]
settings_path.write_text(json.dumps(settings, indent=2) + "\n")
PY
UNLOADED_ALLOFF_BEFORE="$(settings_hash "$PROJECT_UNLOADED_ALLOFF/.pi/settings.json")"
UNLOADED_ALLOFF_DASH="$(trusted_construct_pi "$PROJECT_UNLOADED_ALLOFF" '/construct' 2>&1)"
grep -Fq 'unloaded' <<<"$UNLOADED_ALLOFF_DASH"
if grep -Fq '1 active' <<<"$UNLOADED_ALLOFF_DASH"; then echo "unloaded all-off was reported active"; exit 1; fi
UNLOADED_ALLOFF_SAVE="$(trusted_construct_pi "$PROJECT_UNLOADED_ALLOFF" '/construct save unloaded-alloff-save' 2>&1)"
grep -Fq 'Packages with all resolved resources off: 1' <<<"$UNLOADED_ALLOFF_SAVE"
UNLOADED_ALLOFF_RUN="$(trusted_construct_pi "$PROJECT_UNLOADED_ALLOFF" '/construct run unloaded-package' 2>&1)"
grep -Fq 'all resolved resources are off' <<<"$UNLOADED_ALLOFF_RUN"
if grep -Fq 'Turned on:' <<<"$UNLOADED_ALLOFF_RUN"; then echo "unloaded all-off was applied"; exit 1; fi
test "$UNLOADED_ALLOFF_BEFORE" = "$(settings_hash "$PROJECT_UNLOADED_ALLOFF/.pi/settings.json")"

# 5) Unloaded declaration resolving nothing: skipped as unresolved, never Enabled/Installed.
python3 - "$PROJECT_UNLOADED_UNKNOWN" <<'PY'
import json, pathlib, sys
project = pathlib.Path(sys.argv[1])
(project / ".pi").mkdir(parents=True, exist_ok=True)
(project / ".pi/settings.json").write_text(json.dumps({"packages": ["/nonexistent/unloaded-unknown"]}, indent=2) + "\n")
PY
UNLOADED_UNKNOWN_BEFORE="$(settings_hash "$PROJECT_UNLOADED_UNKNOWN/.pi/settings.json")"
UNLOADED_UNKNOWN_RUN="$(trusted_construct_pi "$PROJECT_UNLOADED_UNKNOWN" '/construct run unloaded-unknown-run' 2>&1)"
grep -Fq 'Unresolved declarations skipped: 1' <<<"$UNLOADED_UNKNOWN_RUN"
if grep -Fq 'Turned on:' <<<"$UNLOADED_UNKNOWN_RUN"; then echo "unloaded unresolved was applied"; exit 1; fi
test "$UNLOADED_UNKNOWN_BEFORE" = "$(settings_hash "$PROJECT_UNLOADED_UNKNOWN/.pi/settings.json")"

# 6) Whole-package-disabled declaration with ZERO resolved resources still Enables (declaration policy).
python3 - "$PROJECT_WHOLE_DISABLED" <<'PY'
import json, pathlib, sys
project = pathlib.Path(sys.argv[1])
(project / ".pi").mkdir(parents=True, exist_ok=True)
entry = {"source": "/nonexistent/whole-disabled", "extensions": [], "skills": [], "prompts": [], "themes": []}
(project / ".pi/settings.json").write_text(json.dumps({"packages": [entry]}, indent=2) + "\n")
PY
WHOLE_DISABLED_RUN="$(trusted_construct_pi "$PROJECT_WHOLE_DISABLED" '/construct run whole-disabled-run' 2>&1)"
grep -Fq 'Enabled: 1' <<<"$WHOLE_DISABLED_RUN"
if grep -Fq 'Pi resolved no package resources' <<<"$WHOLE_DISABLED_RUN"; then echo "whole-disabled zero-resource declaration was skipped"; exit 1; fi
python3 - "$PROJECT_WHOLE_DISABLED" <<'PY'
import json, pathlib, sys
project = pathlib.Path(sys.argv[1])
settings = json.loads((project / ".pi/settings.json").read_text())
assert settings["packages"] == ["/nonexistent/whole-disabled"], settings
PY

# 7) Metadata-managed but undeclared (declaration removed/drift): keep the Install/re-adopt path.
python3 - "$PROJECT_DRIFT" "$PKG_DIR" <<'PY'
import json, pathlib, sys
project = pathlib.Path(sys.argv[1])
source = str(pathlib.Path(sys.argv[2]).resolve())
(project / ".pi").mkdir(parents=True, exist_ok=True)
(project / ".pi/construct.json").write_text(json.dumps({"version": 1, "managedBy": "the-construct", "items": {"construct-e2e-package": {"kind": "package", "source": source, "enabled": True}}}, indent=2) + "\n")
PY
DRIFT_RUN="$(trusted_construct_pi "$PROJECT_DRIFT" '/construct run unloaded-package' 2>&1)"
grep -Fq 'Ran saved loadout: unloaded-package' <<<"$DRIFT_RUN"
grep -Fq 'Installed: 1' <<<"$DRIFT_RUN"
python3 - "$PROJECT_DRIFT" "$PKG_DIR" <<'PY'
import json, pathlib, sys
project = pathlib.Path(sys.argv[1])
source = str(pathlib.Path(sys.argv[2]).resolve())
settings = json.loads((project / ".pi/settings.json").read_text())
assert any(str((pathlib.Path(entry) if pathlib.Path(entry).is_absolute() else project / ".pi" / entry).resolve()) == source for entry in settings.get("packages", [])), settings
PY

# 8) autoload:false override member with all-empty filters: skipped read-only, never Enabled/Installed.
PROJECT_OVERRIDE_MEMBER="$TMP/project-override-member"
mkdir -p "$PROJECT_OVERRIDE_MEMBER"
python3 - "$PROJECT_OVERRIDE_MEMBER" <<'PY'
import json, pathlib, sys
project = pathlib.Path(sys.argv[1])
(project / ".pi").mkdir(parents=True, exist_ok=True)
entry = {"source": "/nonexistent/override-member", "autoload": False, "extensions": [], "skills": [], "prompts": [], "themes": []}
(project / ".pi/settings.json").write_text(json.dumps({"packages": [entry]}, indent=2) + "\n")
PY
OVERRIDE_BEFORE="$(settings_hash "$PROJECT_OVERRIDE_MEMBER/.pi/settings.json")"
OVERRIDE_DASH="$(trusted_construct_pi "$PROJECT_OVERRIDE_MEMBER" '/construct' 2>&1)"
grep -Fq 'Pi override' <<<"$OVERRIDE_DASH"
OVERRIDE_RUN="$(trusted_construct_pi "$PROJECT_OVERRIDE_MEMBER" '/construct run override-member-run' 2>&1)"
grep -Fq 'Pi project overrides skipped: 1' <<<"$OVERRIDE_RUN"
grep -Fq 'manage with pi config -l' <<<"$OVERRIDE_RUN"
if grep -Fq 'Enabled:' <<<"$OVERRIDE_RUN"; then echo "override member was enabled"; exit 1; fi
if grep -Fq 'Turned on:' <<<"$OVERRIDE_RUN"; then echo "override member was applied"; exit 1; fi
test "$OVERRIDE_BEFORE" = "$(settings_hash "$PROJECT_OVERRIDE_MEMBER/.pi/settings.json")"

printf '== removed sync/reload command surface ==\n'
SYNC_OUTPUT="$(construct_pi "$PROJECT_B" '/construct sync' 2>&1)"
grep -Fq 'Unknown /construct subcommand: sync' <<<"$SYNC_OUTPUT"
RELOAD_OUTPUT="$(construct_pi "$PROJECT_B" '/construct reload' 2>&1)"
grep -Fq 'Unknown /construct subcommand: reload' <<<"$RELOAD_OUTPUT"
COPY_OUTPUT="$(construct_pi "$PROJECT_B" '/construct copy pi-projects' 2>&1)"
grep -Fq 'Unknown /construct subcommand: copy' <<<"$COPY_OUTPUT"
PROFILE_OUTPUT="$(construct_pi "$PROJECT_B" '/construct profile list' 2>&1)"
grep -Fq 'Unknown /construct subcommand: profile' <<<"$PROFILE_OUTPUT"
SAVED_OUTPUT="$(construct_pi "$PROJECT_B" '/construct saved' 2>&1)"
grep -Fq 'Unknown /construct subcommand: saved' <<<"$SAVED_OUTPUT"
REMOVE_OUTPUT="$(construct_pi "$PROJECT_B" '/construct remove pi-projects' 2>&1)"
grep -Fq 'Unknown /construct subcommand: remove' <<<"$REMOVE_OUTPUT"

printf 'e2e smoke ok\n'
