# Construct pre-flight checklist

Use disposable `HOME` and fixture projects. Do not edit live global Pi files.

## Current target

Protect the manual product model:

- `/construct` is the primary surface.
- Support commands are `status`, `load`, `unload`, `autoload`, and WIP `profile`.
- No lifecycle/startup behavior.
- No separate toggle/library/catalog command family.
- Read-only checks must not create `.pi/construct.json`.
- Mutating project loadout checks must back up `.pi/settings.json` before direct edits.

## Public command surface

```text
/construct
/construct status
/construct load [id-or-source ...]
/construct unload [id-or-source ...]
/construct autoload
/construct profile list          # WIP, not public yet
/construct profile save <name>   # WIP, not public yet
/construct profile apply <name>  # WIP, not public yet
```

## New-project behavior

Expected:

- `/construct` prints/opens the loadout view.
- `/construct status` reports missing Construct metadata.
- `.pi/construct.json` is not created.

## Manual load

Expected:

- `/construct load` asks in TUI mode and shows only unloaded/adoptable project declarations.
- `/construct load <id-or-source ...>` directly loads matching unloaded/adoptable declarations.
- `/construct load` explicitly loads current project package sources in print mode.
- Load writes the user library and `.pi/construct.json` only because the user explicitly ran load.
- Load does not install, remove, reload, copy, execute, or alter `.pi/settings.json`.

## Manual unload

Expected:

- `/construct unload` asks in TUI mode.
- `/construct unload <id-or-source ...>` removes matching resources from the Construct library.
- Unload prunes matching profile entries and current-project Construct metadata.
- Unload does not remove package declarations from `.pi/settings.json`.
- Unload does not uninstall project packages.

## Autoload

Expected:

- Autoload is off by default.
- `/construct autoload` toggles on/off.
- `/construct autoload on|off|status` works explicitly.
- Autoload watches `.pi/settings.json` during trusted TUI sessions and prompts for newly declared compatible packages after Pi is idle.
- Autoload also scans on quit/exit, not reload or session switch.
- Autoload requires confirmation before writing.
- Autoload does not install, enable, execute, reload, or alter `.pi/settings.json`.

## Profiles

Expected:

- Profile commands remain WIP in public copy.
- `/construct profile save <name>` saves active Construct-managed package sources from the current project.
- `/construct profile list` shows saved profiles.
- `/construct profile apply <name>` turns those package sources on in the current project.
- Profiles are stored in `~/.pi/agent/construct/catalog.json`.
- Profiles store ids/sources, not package code.

## Dashboard safety

Check in real TUI usage:

- fuzzy search works;
- Space selects package rows;
- Enter installs Available, disables Installed, and enables Disabled rows;
- Unloaded rows are read-only in `/construct`, and `/construct load` shows only unloaded/adoptable rows;
- `r` shows a warning, then removes selected Installed or Disabled package declarations;
- Esc cancels;
- package rows stay primary;
- Unloaded rows are clear and do not flood the view;
- runtime inventory stays out of the dashboard and remains visible in status;
- summaries are readable and actionable;
- after runtime-affecting changes, Enter reloads Pi and Esc cancels reload/returns to the session.

## Design review prompts

Before adding new behavior, ask:

- Is this better as part of the one `/construct` menu instead of a new slash command?
- Does every mutating path require explicit user action?
- Are we relying on Pi package/settings primitives instead of rebuilding package management?
- Is `.pi/settings.json` still the source of truth and `.pi/construct.json` only advisory?
- Do profiles still store only library ids/sources and apply explicitly?
- Is Enter still the fastest safe path for common install/disable/enable actions?
- Is `/construct load` still the only adoption path for Unloaded rows?

## Local development

Load this extension from the repo without installing it globally:

```bash
pi --no-extensions -e .
```

Test package install/discovery with a disposable home:

```bash
TMP="$(mktemp -d)"
mkdir -p "$TMP/home" "$TMP/project"
HOME="$TMP/home" pi install "$PWD" --approve
(cd "$TMP/project" && HOME="$TMP/home" pi -p '/construct status')
```

Do not use live global Pi config for tests unless you explicitly mean to.

Repository-local `.pi/settings.json` and `.pi/construct.json` are personal/dev-machine loadout unless that changes deliberately.

## Full validation

```bash
npm run check
npm run smoke:all
npm run release:verify
```

Expected: all pass and no generated package caches/temp files are added to git.
