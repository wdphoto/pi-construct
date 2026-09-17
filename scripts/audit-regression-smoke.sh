#!/usr/bin/env bash
set -euo pipefail
# Isolate even when run standalone: clear inherited agent-dir overrides that bypass $HOME.
unset PI_CODING_AGENT_DIR PI_CODING_AGENT_SESSION_DIR
export PI_OFFLINE=1

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

SENTINEL="SENTINEL_REG_9f3a"   # fake credential; never real

echo '== R1 regression: share refuses secrets without echo; safe share unchanged =='
{
  H="$TMP/r1_home"; P="$TMP/r1_proj"; mkdir -p "$H" "$P" "$H/.pi/agent/construct"
  cat > "$H/.pi/agent/construct/catalog.json" <<JSON
{"version":1,"items":[],"profiles":[
  {"id":"baduser","kind":"profile","items":[],"sources":["https://alice:${SENTINEL}@example.invalid/org/repo"]},
  {"id":"badquery","kind":"profile","items":[],"sources":["https://example.invalid/org/repo?token=${SENTINEL}"]},
  {"id":"goodshare","kind":"profile","items":[],"sources":["npm:good-pkg-1","git:github.com/org/no-secret"]}
]}
JSON
  share_run(){ ( cd "$P" && HOME="$H" pi --no-extensions -e "$ROOT" -p "/construct share $1" ) 2>&1; }

  U="$(share_run baduser)"
  grep -Fq 'Refusing to print source strings that look like they contain secrets' <<<"$U"
  grep -Fq 'Excluded 1 source string.' <<<"$U"
  if printf '%s' "$U" | grep -Fq "alice:${SENTINEL}@example.invalid"; then echo "R1 FAIL: userinfo source echoed"; exit 1; fi
  if printf '%s' "$U" | grep -Fq "$SENTINEL"; then echo "R1 FAIL: userinfo credential echoed"; exit 1; fi

  Q="$(share_run badquery)"
  grep -Fq 'Refusing to print source strings that look like they contain secrets' <<<"$Q"
  grep -Fq 'Excluded 1 source string.' <<<"$Q"
  if printf '%s' "$Q" | grep -Fq "token=${SENTINEL}"; then echo "R1 FAIL: query-token source echoed"; exit 1; fi
  if printf '%s' "$Q" | grep -Fq "$SENTINEL"; then echo "R1 FAIL: query-token credential echoed"; exit 1; fi

  G="$(share_run goodshare)"
  grep -Fq 'Construct loadout share snippet' <<<"$G"
  grep -Fq '"kind": "construct-loadout"' <<<"$G"
  # positive payload: the safe sources must actually be present in the snippet JSON
  grep -Fq '"npm:good-pkg-1"' <<<"$G"
  grep -Fq '"git:github.com/org/no-secret"' <<<"$G"
  if printf '%s' "$G" | grep -Fq 'Refusing'; then echo "R1 FAIL: safe share was refused"; exit 1; fi
  echo "  R1 ok (userinfo + query-token refused without echo; safe share payload intact)"
}

echo '== R2 regression: unload identity-only metadata removal =='
{
  H="$TMP/r2_home"; P="$TMP/r2_proj"; mkdir -p "$H/.pi/agent/construct" "$P/.pi/skills/skill-x" "$P/sibling/localpkg"
  LOCALABS="$( ( cd "$P/sibling/localpkg" && pwd -P ) )"
  cat > "$P/.pi/skills/skill-x/SKILL.md" <<'MD'
---
description: Real skill used for collision test
---
# Skill X
MD
  cat > "$H/.pi/agent/construct/catalog.json" <<'JSON'
{"version":1,"items":[
  {"id":"X","kind":"package","source":"npm:real-A"},
  {"id":"git-eq","kind":"package","source":"git:https://github.com/o/r.git@main"},
  {"id":"npm-eq","kind":"package","source":"npm:foo@1"},
  {"id":"local-eq","kind":"package","source":"../sibling/localpkg"},
  {"id":"skill-x","kind":"package","source":"npm:skill-x-src"}
],"profiles":[
  {"id":"pro1","kind":"profile","items":[],"sources":["npm:real-A","npm:keep"]}
]}
JSON
  cat > "$P/.pi/settings.json" <<'JSON'
{"version":1,"packages":[]}
JSON
  cat > "$P/.pi/construct.json" <<JSON
{"version":1,"managedBy":"the-construct","items":{
  "X":{"kind":"package","source":"npm:unrelated-B","enabled":true},
  "real-a-dup":{"kind":"package","source":"npm:real-A","enabled":true},
  "git-eq-metadata":{"kind":"package","source":"https://github.com/o/r.git","enabled":true},
  "npm-eq-metadata":{"kind":"package","source":"npm:foo@2","enabled":true},
  "local-eq-metadata":{"kind":"package","source":"$LOCALABS","enabled":true},
  "skill-x":{"kind":"skill","path":".pi/skills/skill-x/SKILL.md","enabled":true}
}}
JSON
  S0="$(shasum -a 256 "$P/.pi/settings.json" | awk '{print $1}')"
  F0="$(shasum -a 256 "$P/.pi/skills/skill-x/SKILL.md" | awk '{print $1}')"
  ( cd "$P" && HOME="$H" pi --no-extensions --approve -e "$ROOT" -p '/construct unload X git-eq npm-eq local-eq skill-x' ) >/dev/null 2>&1

  python3 - "$P/.pi/construct.json" <<PY
import json,sys
items=json.load(open(sys.argv[1],encoding="utf-8"))["items"]
assert items.get("X") == {"kind":"package","source":"npm:unrelated-B","enabled":True}, "unrelated same-id item must be preserved exactly"
assert items.get("skill-x") == {"kind":"skill","path":".pi/skills/skill-x/SKILL.md","enabled":True}, "direct metadata must be preserved exactly across package-id collision"
assert "real-a-dup" not in items,       "same-source npm (different id) item must be removed"
assert "git-eq-metadata" not in items,  "equivalent git identity (different id) must be removed"
assert "npm-eq-metadata" not in items,  "equivalent npm identity (version-stripped) must be removed"
assert "local-eq-metadata" not in items, "equivalent local path source (different id) must be removed"
print("  R2 construct-state assertions passed")
PY
  test "$(shasum -a 256 "$P/.pi/settings.json" | awk '{print $1}')" = "$S0" || { echo "R2 FAIL: settings changed"; exit 1; }
  test "$(shasum -a 256 "$P/.pi/skills/skill-x/SKILL.md" | awk '{print $1}')" = "$F0" || { echo "R2 FAIL: skill file changed"; exit 1; }

  # catalog removal + profile pruning also succeed
  python3 - "$H/.pi/agent/construct/catalog.json" <<'PY'
import json,sys
d=json.load(open(sys.argv[1],encoding="utf-8"))
ids={i["id"] for i in d.get("items",[])}
for gone in ("X","git-eq","npm-eq","local-eq","skill-x"):
    assert gone not in ids, f"catalog item {gone} should have been removed"
p=next((g for g in d.get("profiles",[]) if g.get("id")=="pro1"),{})
assert "npm:real-A" not in p.get("sources",[]) and "npm:keep" in p.get("sources",[]), "profile should be pruned of removed source, keep others"
print("  R2 catalog + profile removal assertions passed")
PY
  echo "  R2 ok (identity-only removal; unrelated/direct kept; settings+file unchanged; catalog/profile updated)"
}

echo '== R5 regression: scan canonical root guard =='
{
  FH="$TMP/fakehome"; FPROJ="$FH/proj"; mkdir -p "$FH/.pi/agent" "$FPROJ/.pi"
  ln -s "$FH" "$FH/alias"               # home alias
  ln -s "$FH/.pi" "$FH/private-alias"   # alias pointing at HOME/.pi
  cat > "$FH/.pi/agent/trust.json" <<JSON
{"$FPROJ":true,"$FH/alias":true}
JSON
  cat > "$FPROJ/.pi/settings.json" <<'JSON'
{"version":1,"packages":[]}
JSON
  run_scan_fh(){ ( cd "$FPROJ" && HOME="$FH" pi --no-extensions --approve -e "$ROOT" -p "/construct scan $1" ) 2>&1 | tr -d '\r'; }
  # (scan output can carry `\r` wrapping; tr -d '\r' + grep -a make matching deterministic)
  run_scan_fh "$FH"               | grep -aFq 'home directory is too broad'          # direct home
  run_scan_fh "$FH/alias"         | grep -aFq 'home directory is too broad'          # home alias canonicalized
  run_scan_fh "$FH/private-alias" | grep -aFq 'is a private/global agent directory'  # private-dir alias
  run_scan_fh "$FH/does-not-exist"| grep -aFq 'does not exist'                        # missing path safe
  run_scan_fh "$FPROJ"            | grep -aEq 'Trusted projects scanned: [1-9]'      # ordinary allowed project

  # HOME/.pi is itself a symlink to an external dir -> canonical private-root containment.
  FH2="$TMP/fh2"; EXT="$TMP/ext-pi"; mkdir -p "$FH2" "$EXT" "$EXT/sub"
  ln -s "$EXT" "$FH2/.pi"
  ln -s "$EXT" "$FH2/pi-alias"        # alias resolving to external HOME/.pi target
  ln -s "$EXT/sub" "$FH2/sub-alias"   # external private descendant alias
  run_scan_fh2(){ ( cd "$FH2" && HOME="$FH2" pi --no-extensions --approve -e "$ROOT" -p "/construct scan $1" ) 2>&1 | tr -d '\r'; }
  run_scan_fh2 "$EXT"           | grep -aFq 'is a private/global agent directory'  # canonical private target
  run_scan_fh2 "$FH2/pi-alias"  | grep -aFq 'is a private/global agent directory'  # alias of external private parent
  run_scan_fh2 "$FH2/sub-alias" | grep -aFq 'is a private/global agent directory'  # external private descendant

  # HOME is a symlink; a child of HOME/.pi escapes to an external project dir -> must refuse.
  RCH="$TMP/realhome"; CHL="$TMP/home-alias"; PUB="$TMP/public"
  mkdir -p "$RCH/.pi" "$PUB/.pi"
  ln -s "$RCH" "$CHL"                     # HOME is the symlink path
  ln -s "$PUB" "$RCH/.pi/escape"           # escape symlink inside realhome/.pi -> external project
  printf '{"version":1,"packages":[]}\n' > "$PUB/.pi/settings.json"
  run_esc(){ ( cd "$PUB" && HOME="$CHL" pi --no-extensions --approve -e "$ROOT" -p "/construct scan $CHL/.pi/escape" ) 2>&1 | tr -d '\r'; }
  run_esc | grep -aFq 'is a private/global agent directory'   # must refuse (old guard refused; must not leak Trusted:1)

  # no-arg trusted-root coverage: home-alias trusted root is skipped; allowed project scanned.
  NOARG="$( ( cd "$FPROJ" && HOME="$FH" pi --no-extensions --approve -e "$ROOT" -p '/construct scan' ) 2>&1 | tr -d '\r' )"
  grep -aEq 'Trusted projects scanned: [1-9]' <<<"$NOARG"
  grep -aFq 'trusted root skipped: home directory is too broad' <<<"$NOARG"
  echo "  R5 ok (home+alias+private+missing+external-.pi+no-arg + ordinary project)"
}

echo 'audit-regression smoke ok'
