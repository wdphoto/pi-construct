# Lifecycle and autoload model

## Decision

Construct keeps `/construct autoload` as an explicit on/off toggle, but has **no startup behavior**.

- Do not open Construct when a project loads.
- Do not prompt to load resources on startup.
- Do not install, remove, reload, or write Construct state from startup hooks.
- Keep `/construct load` as the explicit adoption command.

Autoload is off by default and always asks before writing.

Product note: keep autoload transparent. It should surface compatible unloaded package declarations, show source strings, and require confirmation. It should not silently adopt packages under the hood.

## Current behavior

### `/construct`

Main loadout command. It opens or prints the loadout view whether or not `.pi/construct.json` exists.

### `/construct status`

Read-only status. Missing `.pi/construct.json` is reported as missing metadata; status does not create it.

### `/construct load`

Explicit adoption command.

- Reads current project `.pi/settings.json` package declarations.
- Writes the Construct library and selected `.pi/construct.json` metadata.
- Does not install packages, remove packages, reload Pi, execute package code, or edit `.pi/settings.json`.

### `/construct autoload`

Opt-in transparent adoption prompt.

```text
/construct autoload        # toggle on/off
/construct autoload on     # enable
/construct autoload off    # disable
/construct autoload status # show state
```

When enabled, autoload requires:

- TUI mode;
- UI availability;
- trusted project;
- unloaded/adoptable package declarations;
- user confirmation.

It has two transparent checks:

1. **During the session:** Construct watches `.pi/settings.json` or the nearest available parent path. When package declarations change, it waits for Pi to be idle, diffs package declarations against Construct metadata/library, and asks about newly declared compatible packages one by one.
2. **On quit:** Construct scans for remaining unloaded/adoptable package declarations and asks before loading them into Construct.

If confirmed, autoload performs the same metadata-only adoption as `/construct load`. It never installs packages, enables resources, edits `.pi/settings.json`, or reloads Pi.

Pi extension docs/types do not currently expose a first-class package-install event, so Construct does not depend on a private install hook. The settings watcher gives prompt after-install visibility, while the exit-time scan remains the reliable fallback.

See `docs/autoload-transparency.md` for watcher mechanics, cost, security posture, caveats, and future UX improvements.

## Removed legacy behavior

Older development builds experimented with active startup adoption. That model is gone.

Removed behavior:

- `session_start` adoption prompt;
- `maybeOfferAutoload()` startup flow;
- `/construct autosync` compatibility command;
- old skip-list handling;
- `userSkipsPath` in Construct paths/types.

Older local data such as `~/.pi/agent/construct/skips.json` is inert and can be deleted manually. `~/.pi/agent/construct/settings.json` is still used for the current `autoload` boolean.

## Validation

Use disposable homes/projects only.

```bash
npm run check
npm run smoke:all
```

Targeted new-project check:

```bash
TMP="$(mktemp -d)"
mkdir -p "$TMP/home" "$TMP/project"
HOME="$TMP/home" pi install "$PWD" --approve
(cd "$TMP/project" && HOME="$TMP/home" pi -p '/construct status')
```

Expected: status reports missing Construct metadata and `.pi/construct.json` is not created.
