# TODO

Current work should keep Construct manual, explicit, and boring-safe. Do not add lifecycle/startup automation unless we deliberately reopen that design.

## Current state — 2026-06-19 load/unload surface

- `/construct` is the product. It arms/disarms the current project from resources already in the Construct.
- Public support commands are `/construct status`, `/construct load`, `/construct unload`, `/construct autoload`, and WIP `profile` commands.
- Removed public sync/toggle/library/remember/forget/catalog/enable/disable/remove/on/off/reload/wipe command paths.
- `/construct load` adds current project package declarations to the Construct library and arms current-project metadata.
- `/construct unload` removes resources from the Construct library and current-project metadata, but never edits `.pi/settings.json`.
- `/construct autoload` toggles an exit confirmation prompt; it is off by default and never writes without confirmation.
- `/construct status` is read-only and does not create `.pi/construct.json`.
- `.pi/settings.json` remains Pi's source of truth; `.pi/construct.json` remains advisory metadata.

## Now / next

1. [x] Rename the adoption flow from sync to load:
   - `/construct load` is the explicit command for adding current project resources to the Construct.
   - Print mode loads all current project package declarations because the command itself is explicit.
   - TUI mode opens a picker.
   - Load reads `.pi/settings.json`, updates `~/.pi/agent/construct/catalog.json` and selected `.pi/construct.json` metadata, and never installs/removes/reloads/edits `.pi/settings.json`.
2. [x] Add unload from the Construct:
   - `/construct unload` opens a picker in TUI mode.
   - `/construct unload <id-or-source>` removes matching library resources in print mode.
   - Unload prunes saved profile refs and current-project Construct metadata.
   - Unload does not uninstall packages or edit `.pi/settings.json`.
3. [x] Keep profiles WIP:
   - `/construct profile save <name>` saves active Construct-managed packages from the current project.
   - `/construct profile apply <name>` turns on the saved package group in the current project.
   - `/construct profile list` shows saved profiles.
   - Public README copy still marks profiles WIP.
4. [x] Make the one `/construct` menu cleaner:
   - fuzzy typing/filtering;
   - Space toggles;
   - Enter applies;
   - Esc cancels/returns;
   - subtle hints only;
   - in-panel apply progress and summaries;
   - Enter-to-reload after successful dashboard changes.
5. [ ] Decide how project-only rows behave in the one-menu model:
   - read-only with a hint to run `/construct load`;
   - or selectable load from the same menu.
6. [x] Add autoload as an opt-in exit prompt:
   - off by default;
   - toggled by `/construct autoload` or explicit on/off;
   - runs only on session quit;
   - always confirms before writing;
   - never installs/removes/reloads/edits `.pi/settings.json`.
7. [ ] Bring profile apply into the newer in-panel progress/result flow.
8. [ ] Tighten status/drift reporting for normalized local paths vs raw `.pi/settings.json` strings.
9. [ ] Add conflict/doctor visibility for overlapping runtime tool names and duplicate package/resource provenance.
10. [ ] Sweep historical docs after the load/unload direction settles. Keep changelog history, but active docs should not advertise removed commands.

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
