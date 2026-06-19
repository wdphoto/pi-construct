# Autoload removal plan

## Decision

Construct should have **no active startup behavior** in the current product.

- Do not open Construct when a project loads.
- Do not prompt `Load it into the Construct?` on startup.
- Do not load, install, remove, reload, or write Construct state from lifecycle hooks.
- Keep `/construct load` as the explicit public adoption command.
- Current autoload is opt-in, exit-only, and always confirmed.

## Implemented fix

Active autoload code was removed instead of kept as legacy compatibility:

- Removed the `session_start` registration from `extensions/construct/index.ts`.
- Removed the `maybeOfferAutoload()` lifecycle flow.
- Removed old active autoload behavior.
- Removed `/construct autosync` compatibility command.
- Removed user-local skip handling and autoload settings helpers.
- Removed `userSkipsPath` from Construct paths/types.
- Updated status/load output to make manual load the current model.

## Old local data

Older development builds may have written user-local files under `~/.pi/agent/construct/`, for example:

- `settings.json` with old `autoload` / `autosync` keys;
- `skips.json` with projects where the old startup prompt was declined.

Because nobody else is using this yet, there is no migration or compatibility shim. New code simply does not read those keys or files. They are inert leftover data and can be deleted manually if desired.

## New project behavior

A project with no `.pi/construct.json` should still open the full `/construct` loadout/dashboard view when the user explicitly runs `/construct`.

Read-only commands must not create `.pi/construct.json` just to display project state.

Friendly first-run/never-loaded messaging is parked in `TODO.md` under Wishlist.

## Current command model

### `/construct`

Main loadout/dashboard command. It opens the full loadout view whether or not `.pi/construct.json` exists.

### `/construct status`

Read-only project/user status. Missing `.pi/construct.json` is reported as a missing metadata file; status does not create it and does not mention any active autoload capability.

### `/construct load`

Public/default adoption command.

- Reads current project `.pi/settings.json` package declarations.
- Updates Construct library and `.pi/construct.json` metadata only because the user explicitly ran the command.
- Does not install, remove, reload, or run in the background.

### `/construct autoload`

Opt-in exit prompt. It is off by default. When on, it checks for project-only resources during session quit and asks before loading them into the Construct.

It does not run on startup, reload, or session switching. It never installs packages or edits `.pi/settings.json`.

## Validation

Use disposable homes/projects only.

```bash
npm run check
./scripts/smoke.sh
./scripts/e2e-smoke.sh
./scripts/invalid-drift-smoke.sh
./scripts/install-smoke.sh
```

Targeted new-project check:

```bash
TMP="$(mktemp -d)"
mkdir -p "$TMP/home" "$TMP/project"
HOME="$TMP/home" pi install "$PWD" --approve
(cd "$TMP/project" && HOME="$TMP/home" pi -p '/construct status')
```

Expected: `/construct` opens the full loadout view, status reports missing Construct metadata, and `.pi/construct.json` does not exist afterward.
