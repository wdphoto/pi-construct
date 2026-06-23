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

trust_project() {
  local home="$1"
  local project="$2"
  python3 - "$home" "$project" <<'PY'
import json
import pathlib
import sys
home = pathlib.Path(sys.argv[1])
project = pathlib.Path(sys.argv[2]).resolve()
trust_path = home / ".pi/agent/trust.json"
trust_path.parent.mkdir(parents=True, exist_ok=True)
trust_path.write_text(json.dumps({str(project): True}, indent=2) + "\n")
PY
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
trust_project "$HOME_A" "$PROJECT_A"
printf '{ invalid catalog\n' > "$HOME_A/.pi/agent/construct/catalog.json"
OUTPUT="$(construct_pi "$HOME_A" "$PROJECT_A" '/construct load' 2>&1)"
grep -Fq 'Construct load failed.' <<<"$OUTPUT"
grep -Fq 'Construct library catalog could not be read or parsed as JSON' <<<"$OUTPUT"
grep -Fq '{ invalid catalog' "$HOME_A/.pi/agent/construct/catalog.json"
grep -Fq '{ invalid catalog' "$HOME_A/.pi/agent/construct/catalog.json"
test ! -e "$PROJECT_A/.pi/construct.json"

printf '== invalid project settings JSON ==\n'
HOME_B="$TMP/home-invalid-settings"
PROJECT_B="$TMP/project-invalid-settings"
mkdir -p "$HOME_B" "$PROJECT_B/.pi"
printf '{ invalid settings\n' > "$PROJECT_B/.pi/settings.json"
trust_project "$HOME_B" "$PROJECT_B"
OUTPUT="$(construct_pi "$HOME_B" "$PROJECT_B" '/construct load' 2>&1)"
grep -Fq 'Construct load failed.' <<<"$OUTPUT"
grep -Fq '.pi/settings.json could not be read or parsed as JSON' <<<"$OUTPUT"
grep -Fq '{ invalid settings' "$PROJECT_B/.pi/settings.json"
test ! -e "$PROJECT_B/.pi/construct.json"
test ! -e "$HOME_B/.pi/agent/construct/catalog.json"

printf '== invalid project construct JSON ==\n'
HOME_C="$TMP/home-invalid-construct"
PROJECT_C="$TMP/project-invalid-construct"
mkdir -p "$HOME_C" "$PROJECT_C/.pi"
write_settings_with_pkg "$PROJECT_C"
trust_project "$HOME_C" "$PROJECT_C"
printf '{ invalid construct\n' > "$PROJECT_C/.pi/construct.json"
OUTPUT="$(construct_pi "$HOME_C" "$PROJECT_C" '/construct load' 2>&1)"
grep -Fq 'Construct load failed.' <<<"$OUTPUT"
grep -Fq '.pi/construct.json could not be read or parsed as JSON' <<<"$OUTPUT"
grep -Fq '{ invalid construct' "$PROJECT_C/.pi/construct.json"
test ! -e "$HOME_C/.pi/agent/construct/catalog.json"

printf '== load preserves duplicate catalog-id sources ==\n'
HOME_DUP="$TMP/home-duplicate-catalog-ids"
PROJECT_DUP="$TMP/project-duplicate-catalog-ids"
SOURCE_ONE="$TMP/one/tool"
SOURCE_TWO="$TMP/two/tool"
mkdir -p "$HOME_DUP/.pi/agent/construct" "$PROJECT_DUP/.pi" "$SOURCE_ONE" "$SOURCE_TWO"
trust_project "$HOME_DUP" "$PROJECT_DUP"
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

printf '== direct load source selects matching declaration ==\n'
HOME_DIRECT="$TMP/home-direct-load"
PROJECT_DIRECT="$TMP/project-direct-load"
DIRECT_ONE="$TMP/construct-direct-one"
DIRECT_TWO="$TMP/construct-direct-two"
mkdir -p "$HOME_DIRECT" "$PROJECT_DIRECT/.pi" "$DIRECT_ONE" "$DIRECT_TWO"
python3 - "$PROJECT_DIRECT" "$DIRECT_ONE" "$DIRECT_TWO" <<'PY'
import json
import pathlib
import sys
project = pathlib.Path(sys.argv[1])
one = str(pathlib.Path(sys.argv[2]).resolve())
two = str(pathlib.Path(sys.argv[3]).resolve())
(project / ".pi/settings.json").write_text(json.dumps({"packages": [one, two]}, indent=2) + "\n")
PY
trust_project "$HOME_DIRECT" "$PROJECT_DIRECT"
OUTPUT="$(construct_pi "$HOME_DIRECT" "$PROJECT_DIRECT" "/construct load $DIRECT_ONE" 2>&1)"
grep -Fq 'Construct load complete.' <<<"$OUTPUT"
python3 - "$HOME_DIRECT" "$PROJECT_DIRECT" "$DIRECT_ONE" <<'PY'
import json
import pathlib
import sys
home = pathlib.Path(sys.argv[1])
project = pathlib.Path(sys.argv[2])
source = str(pathlib.Path(sys.argv[3]).resolve())
catalog = json.loads((home / ".pi/agent/construct/catalog.json").read_text())
construct = json.loads((project / ".pi/construct.json").read_text())
assert [item.get("source") for item in catalog.get("items", [])] == [source], catalog
items = list(construct.get("items", {}).values())
assert len(items) == 1, construct
assert items[0].get("source") == source, construct
assert items[0].get("enabled") is True, construct
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

printf '== drift: metadata disabled but settings missing source ==\n'
HOME_E="$TMP/home-disabled-drift"
PROJECT_E="$TMP/project-disabled-drift"
mkdir -p "$HOME_E/.pi/agent" "$PROJECT_E/.pi"
python3 - "$HOME_E" "$PROJECT_E" <<'PY'
import json
import pathlib
import sys
home = pathlib.Path(sys.argv[1])
project = pathlib.Path(sys.argv[2]).resolve()
(home / ".pi/agent/trust.json").write_text(json.dumps({str(project): True}, indent=2) + "\n")
PY
cat > "$PROJECT_E/.pi/settings.json" <<'JSON'
{
  "packages": []
}
JSON
python3 - "$PROJECT_E" "$PKG_DIR" <<'PY'
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
      "enabled": False
    }
  }
}, indent=2) + "\n")
PY
OUTPUT="$(construct_pi "$HOME_E" "$PROJECT_E" '/construct status' 2>&1)"
grep -Fq 'drift: disabled in Construct metadata, missing from .pi/settings.json' <<<"$OUTPUT"
OUTPUT="$(construct_pi "$HOME_E" "$PROJECT_E" '/construct scan .' 2>&1)"
grep -Fq 'Drifted Construct metadata: 1' <<<"$OUTPUT"
grep -Fq 'Drifted Construct metadata' <<<"$OUTPUT"
grep -Fq 'Run /construct scan in TUI to select drifted metadata for reconciliation. Print scan is read-only.' <<<"$OUTPUT"
grep -Fq 'disabled in Construct metadata, missing from .pi/settings.json' <<<"$OUTPUT"
OUTPUT="$(construct_pi "$HOME_E" "$PROJECT_E" '/construct' 2>&1)"
grep -Fq 'drift: disabled in Construct metadata, missing from .pi/settings.json' <<<"$OUTPUT"

printf '== load re-arms disabled metadata with active settings ==\n'
HOME_REARM="$TMP/home-rearm-drift"
PROJECT_REARM="$TMP/project-rearm-drift"
mkdir -p "$HOME_REARM" "$PROJECT_REARM/.pi"
python3 - "$PROJECT_REARM" "$PKG_DIR" <<'PY'
import json
import pathlib
import sys
project = pathlib.Path(sys.argv[1])
source = sys.argv[2]
(project / ".pi/settings.json").write_text(json.dumps({"packages": [source]}, indent=2) + "\n")
(project / ".pi/construct.json").write_text(json.dumps({
  "version": 1,
  "managedBy": "the-construct",
  "items": {
    "construct-invalid-drift-package": {
      "kind": "package",
      "source": source,
      "enabled": False
    }
  }
}, indent=2) + "\n")
PY
trust_project "$HOME_REARM" "$PROJECT_REARM"
OUTPUT="$(construct_pi "$HOME_REARM" "$PROJECT_REARM" '/construct load' 2>&1)"
grep -Fq 'Project items armed: 1' <<<"$OUTPUT"
OUTPUT="$(construct_pi "$HOME_REARM" "$PROJECT_REARM" '/construct status' 2>&1)"
grep -Fq 'Construct-managed: 1 enabled · 0 disabled' <<<"$OUTPUT"
! grep -Fq 'drift:' <<<"$OUTPUT"

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
NORMALIZED_PKG="$(python3 - "$PROJECT_F" <<'PY'
import pathlib
import sys
print((pathlib.Path(sys.argv[1]) / "pkg").resolve())
PY
)"
grep -Fq -- "- ../pkg (string, normalized $NORMALIZED_PKG)" <<<"$OUTPUT"
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
trust_project "$HOME_G" "$PROJECT_G"
OUTPUT="$(construct_pi "$HOME_G" "$PROJECT_G" '/construct load' 2>&1)"
grep -Fq 'No project resources are waiting to be loaded.' <<<"$OUTPUT"
test ! -e "$HOME_G/.pi/agent/construct/catalog.json"

printf '== duplicate local metadata collapses to one dashboard row ==\n'
HOME_I="$TMP/home-duplicate-local-metadata"
PROJECT_I="$TMP/project-duplicate-local-metadata"
PKG_I="$TMP/pi-tripwire"
mkdir -p "$HOME_I/.pi/agent/construct" "$PROJECT_I/.pi" "$PKG_I/extensions"
python3 - "$HOME_I" "$PROJECT_I" "$PKG_I" <<'PY'
import json
import pathlib
import sys
home = pathlib.Path(sys.argv[1])
project = pathlib.Path(sys.argv[2])
pkg = pathlib.Path(sys.argv[3]).resolve()
relative = "../../pi-tripwire"
(home / ".pi/agent/construct/catalog.json").write_text(json.dumps({
  "version": 1,
  "items": [{"id": "pi-tripwire", "kind": "package", "source": str(pkg)}],
  "profiles": []
}, indent=2) + "\n")
(project / ".pi/settings.json").write_text(json.dumps({"packages": [{
  "source": relative,
  "extensions": [],
  "skills": [],
  "prompts": [],
  "themes": []
}]}, indent=2) + "\n")
(project / ".pi/construct.json").write_text(json.dumps({
  "version": 1,
  "managedBy": "the-construct",
  "items": {
    "pi-tripwire": {"kind": "package", "source": str(pkg), "enabled": False},
    "pi-tripwire-2": {"kind": "package", "source": relative, "requestedSource": str(pkg), "enabled": False}
  }
}, indent=2) + "\n")
PY
trust_project "$HOME_I" "$PROJECT_I"
OUTPUT="$(construct_pi "$HOME_I" "$PROJECT_I" '/construct' 2>&1)"
grep -Fq '0 active · 1 disabled · 0 available · 0 unloaded' <<<"$OUTPUT"
grep -Fq 'pi-tripwire' <<<"$OUTPUT"
! grep -Fq 'pi-tripwire-2' <<<"$OUTPUT"
OUTPUT="$(construct_pi "$HOME_I" "$PROJECT_I" '/construct status' 2>&1)"
grep -Fq 'Construct-managed: 0 enabled · 1 disabled' <<<"$OUTPUT"

printf '== local-only package declaration ==\n'
HOME_E="$TMP/home-local-only"
PROJECT_E="$TMP/project-local-only"
mkdir -p "$HOME_E" "$PROJECT_E"
write_settings_with_pkg "$PROJECT_E"
OUTPUT="$(construct_pi "$HOME_E" "$PROJECT_E" '/construct' 2>&1)"
grep -Fq 'Unloaded' <<<"$OUTPUT"
grep -Fq 'construct-invalid-drift-package' <<<"$OUTPUT"
test ! -e "$PROJECT_E/.pi/construct.json"

printf '== load disabled declaration preserves disabled metadata ==\n'
HOME_H="$TMP/home-load-disabled"
PROJECT_H="$TMP/project-load-disabled"
mkdir -p "$HOME_H" "$PROJECT_H/.pi"
python3 - "$PROJECT_H" "$PKG_DIR" <<'PY'
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
  "themes": []
}]}, indent=2) + "\n")
PY
trust_project "$HOME_H" "$PROJECT_H"
OUTPUT="$(construct_pi "$HOME_H" "$PROJECT_H" '/construct load' 2>&1)"
grep -Fq 'Construct load complete.' <<<"$OUTPUT"
python3 - "$PROJECT_H" <<'PY'
import json
import pathlib
import sys
project = pathlib.Path(sys.argv[1])
construct = json.loads((project / ".pi/construct.json").read_text())
items = construct.get("items", {})
assert len(items) == 1, construct
assert next(iter(items.values())).get("enabled") is False, construct
PY
OUTPUT="$(construct_pi "$HOME_H" "$PROJECT_H" '/construct status' 2>&1)"
grep -Fq 'Construct-managed: 0 enabled · 1 disabled' <<<"$OUTPUT"
! grep -Fq 'drift:' <<<"$OUTPUT"

printf 'invalid/drift smoke ok\n'
