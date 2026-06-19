# Commands and UX

Construct is intentionally back to one primary command.

## Public command surface

```text
/construct             # one loadout menu / dashboard
/construct status      # read-only diagnostics
/construct sync        # choose current project packages to remember
/construct sync -a     # remember all new current project packages
/construct sync status # explain sync behavior
/construct reload      # reload Pi resources
```

No separate public load/unload/toggle/library/catalog command family for now. The extra verbs made the MVP feel like a tiny package manager. The product direction is a single searchable loadout menu.

## `/construct`

In TUI mode, `/construct` is the place to see and change project loadout state.

Sections:

- `ON — Construct packages`: remembered/managed sources declared in this project.
- `OFF — Construct packages`: remembered/managed sources disabled here.
- `AVAILABLE — Construct library`: remembered sources available to turn on.
- `LOCAL-ONLY — not in Construct`: project package declarations not adopted yet.
- Runtime skills/commands: read-only inventory.

Controls:

- type to search/filter;
- Space toggles enabled package rows;
- Enter saves selected package diffs;
- Esc cancels without writing.

Keep hints subtle and summaries quiet. Success output should be short and end with reload guidance.

In print mode, `/construct` prints a read-only dashboard. Non-interactive package changes are intentionally limited while the MVP centers the TUI.

## `/construct sync`

Sync is explicit adoption only.

- Reads current project `.pi/settings.json` package declarations.
- Adds selected package sources to the user Construct library.
- Writes advisory `.pi/construct.json` metadata for adopted packages.
- Never installs, removes, reloads, copies files, executes package code, or edits `.pi/settings.json`.

Use `/construct sync -a` when a non-interactive adopt-all path is needed.

## Removed surface

The old separate command family was removed from active UX:

```text
load, unload, toggle, library, remember, forget, catalog,
enable, disable, remove, on, off, wipe
```

Package load/unload remains as internal dashboard behavior, implemented through Pi's native project-local package commands.
