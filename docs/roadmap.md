# Roadmap and future work

## Current status

The MVP is intentionally small again:

- `/construct` one-menu loadout dashboard.
- `/construct status` read-only diagnostics.
- `/construct sync` manual adoption menu.
- `/construct sync -a` explicit adopt-all shortcut.
- `/construct reload` resource reload helper.
- No startup/autoload behavior.
- No separate public load/unload/toggle/library/catalog command family.

Package load/unload remains an internal dashboard operation, not separate user-facing slash commands.

## Current cleanup priorities

1. Polish the one `/construct` menu.
2. Improve filtering/search so package rows are easy to find even when runtime skill commands are numerous.
3. Decide local-only row behavior:
   - keep read-only with `/construct sync` hint;
   - or allow adoption from the dashboard.
4. Improve normalized path drift reporting.
5. Add conflict/doctor visibility for duplicate tools/resources.

## Phase plan

### Phase 1 — Keep current package loop working ✅

- Package-root extension layout works via:
  ```bash
  pi --no-extensions -e .
  ```
- Smoke checks use disposable `HOME` and project directories.
- Live global Pi config is not touched during development.

### Phase 2 — Manual library sync ✅

- `/construct sync` explicitly adopts package declarations from current project `.pi/settings.json`.
- `/construct sync -a` is the non-interactive adopt-all path.
- Sync never installs, removes, reloads, copies, executes, or edits `.pi/settings.json`.

### Phase 3 — One menu loadout management 🚧

- `/construct` should be the single place to turn remembered package sources on/off.
- Keep UI hints subtle.
- Keep success/error summaries minimal.
- Keep runtime skills/commands read-only until package-level filtering is worth doing.

### Phase 4 — Groups and profile groundwork

- Add optional `groups` to library items.
- Use groups only to organize the one dashboard first.
- Do not build full profile apply/export until the simple dashboard feels boring-safe.

### Phase 5 — Future profile/export work

- Profiles/loadouts as named sets of library item ids.
- Export/import readable Construct scripts.
- Local-file packaging/export for `.pi/extensions`, prompts, skills, themes.
- Resource-level package filters only if truly needed.
- Doctor/update commands.

## Open questions

- Should local-only package rows be adoptable directly from `/construct`?
- How much runtime inventory should the dashboard show by default?
- How far should npm/git identity normalization go beyond exact source strings and local realpaths?
- Should status become more doctor-like, or should doctor be a later separate command?
