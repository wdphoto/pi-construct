# TODO

Current work should keep Construct manual, explicit, and boring-safe. Do not add lifecycle/startup automation unless we deliberately reopen that design.

## Current state — 2026-06-19 command-surface reset

- `/construct` is the product. Keep the extra slash-command surface minimal and quiet.
- Public support commands are `/construct status`, `/construct sync`, `/construct sync auto`, `/construct sync off`, `/construct profile list/save/apply`, and `/construct reload`.
- Removed public load/unload/toggle/library/remember/forget/catalog/enable/disable/remove/on/off/wipe command paths.
- Package load/unload still exists internally for the `/construct` dashboard to apply menu diffs.
- `/construct status` is read-only and does not create `.pi/construct.json`.
- `/construct sync` is manual adoption only; `/construct sync auto` is the explicit adopt-all shortcut.
- `.pi/settings.json` remains Pi's source of truth; `.pi/construct.json` remains advisory metadata.

## Now / next

1. [x] Redesign `/construct sync` semantics:
   - Fold `/construct sync status` into `/construct status`; status should explain that sync is manual, when it runs, and what files it may write.
   - `/construct sync` opens the sync/adoption menu, like `/construct`: show package declarations from current `.pi/settings.json` that are not yet Construct-managed, let the user select what to sync, and apply only the selection.
   - `/construct sync auto` adopts every available current-project package declaration without opening the menu. Keep `-a` / `--all` as hidden compatibility aliases if useful, but docs/output should prefer `auto`.
   - `/construct sync on` is just an alias for `/construct sync`; do not imply a persistent “on” state.
   - `/construct sync off` should be a harmless no-op/help path: automatic sync is off because Construct only syncs when explicitly invoked.
   - Sync runs only from explicit commands, never on startup/dashboard/status. It reads `.pi/settings.json`, updates `~/.pi/agent/construct/catalog.json` and selected `.pi/construct.json` metadata, and never installs/removes/reloads/edits `.pi/settings.json`.
2. [x] Add basic profiles/loadouts:
   - `/construct profile save <name>` saves active Construct-managed packages from the current project.
   - `/construct profile apply <name>` turns on the saved package group in the current project.
   - `/construct profile list` shows saved profiles.
   - Example profiles: `www`, `golang`, `pi-projects`.
   - Profiles store library item ids/sources, not copied package code.
   - Future polish: fold profiles into the main `/construct` menu so applying a stack is a first-class selectable row.
3. [x] Fix sync source identity edge cases:
   - duplicate derived/catalog ids no longer overwrite project metadata during one sync pass;
   - sync reuses shared source identity normalization for managed metadata;
   - `requestedSource` local paths normalize relative to project cwd.
4. [x] Fix post-save loadout output placement:
   - dashboard/sync/profile success summaries now use a focused TUI summary panel;
   - print mode still writes normal command output.
5. [ ] Add npm package/release follow-through:
   - decide whether this stays private for now or gets published;
   - set the package name/version/release notes deliberately;
   - confirm what files ship in `files`;
   - document the publish/release flow once chosen.
6. [ ] Make the one `/construct` menu excellent:
   - fuzzy typing/filtering;
   - Space toggles;
   - Enter saves;
   - Esc cancels;
   - subtle hints only;
   - minimal success/error summaries.
7. [ ] Improve dashboard filtering so runtime skill/command inventory does not drown package loadout rows.
8. [ ] Decide how local-only rows behave in the one-menu model:
   - read-only with a hint to run `/construct sync`;
   - or selectable adoption from the same menu.
9. [ ] Tighten status/drift reporting for normalized local paths vs raw `.pi/settings.json` strings.
10. [ ] Add conflict/doctor visibility for overlapping runtime tool names and duplicate package/resource provenance; observed `npm:@ollama/pi-web-search` and `https://github.com/nicobailon/pi-web-access` both registering `web_search` in `~/Code/scratch-pi`.
11. [ ] Sweep old docs under `docs/` after the new one-menu direction settles. Keep historical notes if useful, but active docs should not advertise removed commands.

## Validation to keep running

```bash
npm run check
npm run smoke
npm run e2e-smoke
npm run install-smoke
npm run invalid-drift-smoke
```

Use disposable `HOME`/project directories for install/discovery checks.

## Wishlist / later

- Friendly first-run/never-loaded messaging for projects with no `.pi/construct.json`, triggered only by explicit `/construct`.
- Optional onboarding/startup automation behind an explicit opt-in toggle.
- Groups/profiles as lists of remembered library source ids.
- Support Pi package filters as a conflict-resolution/fine-grained toggle layer, e.g. keep a package declared but set `extensions: []`, `skills: []`, `prompts: []`, or `themes: []` instead of unloading the whole package.
- Optional parallel package installs/removals for multi-select flows. Be careful: `pi install -l` / `pi remove -l` and Construct metadata writes mutate the same `.pi/settings.json` / `.pi/construct.json`, so this needs locking or safe merge semantics before we leave sequential execution.
