# Roadmap and future work

## Current status

Construct is intentionally small, but profiles now exist as a low-click grouping layer:

- `/construct` one-menu loadout dashboard.
- `/construct status` read-only diagnostics.
- `/construct sync` manual adoption menu.
- `/construct sync auto` explicit adopt-all shortcut.
- `/construct profile save/apply/list` for named groups of remembered packages.
- `/construct reload` resource reload helper.
- No startup/autoload behavior.
- No separate public load/unload/toggle/library/catalog command family.

Package load/unload remains an internal dashboard/profile operation, not separate user-facing slash commands.

## Current cleanup priorities

1. Fold profiles into the main `/construct` TUI as first-class selectable rows/groups.
2. Polish the one `/construct` menu.
3. Improve filtering/search so package rows are easy to find even when runtime skill commands are numerous.
4. Decide local-only row behavior:
   - keep read-only with `/construct sync` hint;
   - or allow adoption from the dashboard.
5. Improve normalized path drift reporting.
6. Add conflict/doctor visibility for duplicate tools/resources.

## Profile direction

Profiles should stay boring:

- named groups like `www`, `golang`, `pi-projects`;
- references to Construct library ids/sources;
- no copied package code;
- explicit apply only;
- show what will turn on/off before writing once the TUI version exists.

## Future work

- Groups/profile organization in the dashboard.
- Export/import readable Construct scripts.
- Local-file packaging/export for `.pi/extensions`, prompts, skills, themes.
- Resource-level package filters only if truly needed.
- Doctor/update commands.
