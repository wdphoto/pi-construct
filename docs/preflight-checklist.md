# Construct pre-flight checklist

Use disposable `HOME` and fixture projects. Do not edit live global Pi files.

## Current target

Protect the manual MVP:

- `/construct` is the primary surface.
- Support commands are `status`, `sync`, `profile`, and `reload`.
- No lifecycle/startup behavior.
- No separate load/unload/toggle/library/catalog command family.
- Read-only checks must not create `.pi/construct.json`.
- Mutating checks must back up `.pi/settings.json` before direct edits.

## Public command surface

```text
/construct
/construct status
/construct sync
/construct sync auto
/construct sync off
/construct profile list
/construct profile save <name>
/construct profile apply <name>
/construct reload
```

## New-project behavior

Expected:

- `/construct` prints/opens the loadout view.
- `/construct status` reports missing Construct metadata.
- `.pi/construct.json` is not created.

## Manual sync adoption

Expected:

- `/construct sync` asks in TUI mode or instructs in print mode.
- `/construct sync auto` adopts current project package sources.
- `/construct sync off` does not write anything.
- Sync writes the user library and `.pi/construct.json` only because the user explicitly ran sync.
- Sync does not install, remove, reload, copy, execute, or alter `.pi/settings.json`.

## Profiles

Expected:

- `/construct profile save <name>` saves active Construct-managed package sources from the current project.
- `/construct profile list` shows saved profiles.
- `/construct profile apply <name>` turns those package sources on in the current project.
- Profiles are stored in `~/.pi/agent/construct/catalog.json`.
- Profiles store ids/sources, not package code.

## Dashboard safety

Check in real TUI usage:

- fuzzy search works;
- Space toggles package rows;
- Enter saves;
- Esc cancels;
- local-only/runtime rows are clear;
- summaries are minimal;
- reload guidance is present after changes.

## Full validation

```bash
npm run check
npm run smoke
npm run e2e-smoke
npm run invalid-drift-smoke
npm run install-smoke
```

Expected: all pass and no generated package caches/temp files are added to git.
