# Construct pre-flight checklist

Use this for a manual check and cleanup pass before adding more features. Work one item at a time. Do not move to the next item until the current item is either checked off or explicitly parked with notes.

## Ground rules

- Use disposable `HOME` and fixture projects for behavior checks.
- Do not edit live global Pi files.
- Do not install into live global Pi config.
- Read-only checks should not create `.pi/construct.json`.
- Mutating checks must back up `.pi/settings.json` when editing existing settings.
- Keep `/construct sync` manual; no lifecycle/startup behavior.

## 0. Current cleanup target

**Target:** keep the completed autoload-removal refactor from drifting while polishing the MVP surface.

Definition of done for the completed pass:

- No Construct lifecycle hook prompts, opens `/construct`, syncs, reloads, installs, or writes files.
- `/construct autoload` and `/construct autosync` are gone, including completions/help/tests.
- `/construct` opens the full loadout view when `.pi/construct.json` is missing, without writing metadata.
- `/construct sync` remains the explicit adoption command.
- Docs agree with code.
- Smoke checks pass in disposable environments.

Next pass target:

- Manual interactive TUI check for `/construct`, `/construct load`, `/construct unload`, and multi-item `/construct sync`.
- Output/wording polish for status, sync, library, load, unload, toggle, and dashboard.

## 1. Static code sweep — no startup behavior

Check:

```bash
rg -n "pi\.on\(|session_start|session_shutdown|resources_discover|autoload|autosync|maybeOfferAutoload|userSkipsPath|skips|userSettingsPath" extensions scripts
```

Expected:

- No lifecycle registrations in Construct code unless intentionally added later.
- No autoload/autosync implementation files or imports.
- No user-local skip/settings path still wired into runtime code.

Notes:

- If `pi.on(` returns in future for another reason, inspect it manually and verify it cannot mutate project/user state on load.

## 2. Public command surface sweep

Check:

```bash
rg -n "autoload|autosync|sync on|sync off|compatibility no-op" README.md docs the-construct-plan.md extensions scripts
```

Expected:

- Autoload/autosync appear only in historical/removal/checklist wording, not as active commands, completions, or help suggestions.
- Help/completions mention only active public commands:
  - `/construct`
  - `/construct status`
  - `/construct load`
  - `/construct unload`
  - `/construct toggle`
  - `/construct sync`
  - `/construct sync status`
  - `/construct library`
  - `/construct remember`
  - `/construct forget`
  - `/construct reload`

## 3. Startup silence and new-project command behavior

Startup rule:

- Construct should print nothing just because a project loads.
- `/construct` should open the full loadout view even when `.pi/construct.json` is missing.
- Friendly first-run/never-loaded messaging belongs in the wishlist until later automation/onboarding work.

Check explicit commands with disposable state:

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

- Starting/loading the project does not print Construct onboarding text.
- `/construct` prints/opens the full `Construct loadout` view.
- `/construct status` reports missing Construct metadata without special first-run copy.
- `.pi/construct.json` is not created by either command.

## 4. Manual sync adoption

Check:

```bash
TMP="$(mktemp -d)"
mkdir -p "$TMP/home" "$TMP/project" "$TMP/pkg/extensions"
# create a tiny Pi package in "$TMP/pkg", add it to "$TMP/project/.pi/settings.json",
# then run HOME="$TMP/home" pi --no-extensions -e "$PWD" -p '/construct sync'
```

Expected:

- `/construct sync` adopts the package source into `~/.pi/agent/construct/catalog.json`.
- `/construct sync` writes `.pi/construct.json` because the user explicitly ran sync.
- It does not install, remove, reload, or alter `.pi/settings.json`.

## 5. Load/unload/toggle safety

Check:

- `/construct load <source-or-id>` uses Pi project install path.
- `/construct unload <source-or-id>` removes only the package declaration, not local source files or package caches.
- `/construct toggle` only affects Construct-managed packages.
- Existing `.pi/settings.json` gets a timestamped backup before direct edits.

Useful commands:

```bash
./scripts/e2e-smoke.sh
```

## 6. Invalid JSON and drift checks

Automated check:

```bash
./scripts/invalid-drift-smoke.sh
```

Cases covered:

- invalid user catalog JSON;
- invalid project `.pi/settings.json`;
- invalid project `.pi/construct.json`;
- `.pi/construct.json` says enabled but `.pi/settings.json` no longer has the source;
- `.pi/settings.json` has local-only packages not in Construct metadata.

Expected:

- Commands fail safely and do not overwrite invalid files.
- Status reports drift clearly.
- Mutating commands avoid unsafe writes.

## 7. Full validation

Run:

```bash
npm run check
./scripts/smoke.sh
./scripts/e2e-smoke.sh
./scripts/invalid-drift-smoke.sh
./scripts/install-smoke.sh
```

Expected:

- All pass.
- No generated package caches or temp files are added to git.

## Current pass notes

- Autoload removal code refactor is in place.
- First-run dashboard/status smoke coverage is in place.
- 2026-06-18: **1. Static code sweep — no startup behavior** passed. `rg` found no lifecycle/autoload/autosync/skips/user-settings wiring in `extensions` or `scripts`.
- 2026-06-18: **2. Public command surface sweep** passed. Autoload/autosync references are limited to historical/removal/checklist wording; command completions/help list only active commands.
- 2026-06-18: **3. Startup silence and new-project command behavior** passed. `/construct` opens the full loadout view, first-run messaging moved to `TODO.md` Wishlist, and manual check confirmed no `.pi/construct.json` was created in `pi-pavlov`.
- 2026-06-18: **4. Manual sync adoption** passed via disposable temp project/package. `/construct sync` adopted one package into catalog, wrote `.pi/construct.json`, and left `.pi/settings.json` unchanged.
- 2026-06-18: **5. Load/unload/toggle safety** passed via `./scripts/e2e-smoke.sh`. Added assertions that unload/toggle-off do not delete local package or extension source files.
- 2026-06-18: **6. Invalid JSON and drift checks** passed via `./scripts/invalid-drift-smoke.sh`. Tightened `/construct sync` to fail before writes when project settings, project metadata, or the user catalog are invalid.
- 2026-06-18: **7. Full validation** passed: `npm run check`, `./scripts/smoke.sh`, `./scripts/e2e-smoke.sh`, `./scripts/invalid-drift-smoke.sh`, and `./scripts/install-smoke.sh`.
- Pre-flight checklist complete.
