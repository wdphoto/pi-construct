# Construct pre-flight checklist

Use disposable `HOME` and fixture projects. Do not edit live global Pi files.

## Current target

Protect the one-menu MVP:

- `/construct` is the primary surface.
- Support commands are only `status`, `sync`, and `reload`.
- No lifecycle/startup behavior.
- No separate load/unload/toggle/library/catalog command family.
- Read-only checks must not create `.pi/construct.json`.
- Mutating checks must back up `.pi/settings.json` before direct edits.

## 1. Static code sweep — no startup behavior

```bash
rg -n "pi\.on\(|session_start|session_shutdown|resources_discover|autoload|autosync|maybeOfferAutoload|userSkipsPath|skips|userSettingsPath" extensions scripts
```

Expected: no Construct lifecycle/autoload/autosync runtime wiring.

## 2. Public command surface sweep

```bash
rg -n "registerCommand|Unknown /construct subcommand|getArgumentCompletions" extensions/construct/index.ts
```

Expected active surface:

```text
/construct
/construct status
/construct sync
/construct sync -a
/construct sync status
/construct reload
```

## 3. New-project behavior

```bash
ROOT="$(pwd)"
TMP="$(mktemp -d)"
mkdir -p "$TMP/home" "$TMP/project"
(
  cd "$TMP/project"
  HOME="$TMP/home" pi --no-extensions -e "$ROOT" -p '/construct'
  HOME="$TMP/home" pi --no-extensions -e "$ROOT" -p '/construct status'
)
find "$TMP/project" -maxdepth 3 -type f | sort
```

Expected:

- `/construct` prints/opens the loadout view.
- `/construct status` reports missing Construct metadata.
- `.pi/construct.json` is not created.

## 4. Manual sync adoption

Expected:

- `/construct sync` asks in TUI mode or instructs in print mode.
- `/construct sync -a` adopts current project package sources.
- Sync writes the user library and `.pi/construct.json` only because the user explicitly ran sync.
- Sync does not install, remove, reload, copy, execute, or alter `.pi/settings.json`.

## 5. Dashboard safety

Check in real TUI usage:

- fuzzy search works;
- Space toggles package rows;
- Enter saves;
- Esc cancels;
- local-only/runtime rows are clear;
- summaries are minimal;
- reload guidance is present after changes.

## 6. Invalid JSON and drift checks

```bash
./scripts/invalid-drift-smoke.sh
```

Expected:

- invalid user catalog JSON fails safely;
- invalid project settings fails safely;
- invalid Construct metadata fails safely;
- drift is reported clearly.

## 7. Full validation

```bash
npm run check
npm run smoke
npm run e2e-smoke
npm run invalid-drift-smoke
npm run install-smoke
```

Expected: all pass and no generated package caches/temp files are added to git.
