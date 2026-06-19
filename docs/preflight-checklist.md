# Construct pre-flight checklist

Use disposable `HOME` and fixture projects. Do not edit live global Pi files.

## Current target

Protect the manual product model:

- `/construct` is the primary surface.
- Support commands are `status`, `sync`, and `profile`.
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
- Enter applies;
- Esc cancels;
- package rows stay primary;
- project-only rows are clear, read-only, and do not flood the view;
- runtime inventory stays out of the dashboard and remains visible in status;
- summaries are readable and actionable;
- after changes, Enter reloads Pi and Esc returns to the session.

## Design review prompts

Before adding new behavior, ask:

- Is this better as part of the one `/construct` menu instead of a new slash command?
- Does every mutating path require explicit user action?
- Are we relying on Pi package/settings primitives instead of rebuilding package management?
- Is `.pi/settings.json` still the source of truth and `.pi/construct.json` only advisory?
- Do profiles still store only library ids/sources and apply explicitly?
- Would local-only package adoption be clearer as read-only guidance or as a dashboard action?

## Full validation

```bash
npm run check
npm run smoke
npm run e2e-smoke
npm run invalid-drift-smoke
npm run install-smoke
```

Expected: all pass and no generated package caches/temp files are added to git.
