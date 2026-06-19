# TODO

Current work should keep the MVP manual, explicit, and boring-safe. Do not add lifecycle/startup automation unless we deliberately reopen that design.

## Current state — 2026-06-19 command-surface reset

- `/construct` is the product. Keep the extra slash-command surface minimal and quiet.
- Public support commands are only `/construct status`, `/construct sync`, `/construct sync -a`, `/construct sync status`, and `/construct reload`.
- Removed public load/unload/toggle/library/remember/forget/catalog/enable/disable/remove/on/off/wipe command paths.
- Package load/unload still exists internally for the `/construct` dashboard to apply menu diffs.
- `/construct status` is read-only and does not create `.pi/construct.json`.
- `/construct sync` is manual adoption only; `/construct sync -a` is the explicit adopt-all shortcut.
- `.pi/settings.json` remains Pi's source of truth; `.pi/construct.json` remains advisory metadata.

## Now / next

1. [ ] Add npm package/release follow-through:
   - decide whether this stays private for now or gets published;
   - set the package name/version/release notes deliberately;
   - confirm what files ship in `files`;
   - document the publish/release flow once chosen.
2. [ ] Make the one `/construct` menu excellent:
   - fuzzy typing/filtering;
   - Space toggles;
   - Enter saves;
   - Esc cancels;
   - subtle hints only;
   - minimal success/error summaries.
3. [ ] Fix post-save loadout output placement. Current save/apply output can appear in the footer/loader area and break the TUI layout, e.g.:
   ```text
   Construct loadout changes applied.
   Turned on: 2/2
   + pi-subagents: https://github.com/nicobailon/pi-subagents
   + pi-web-access: https://github.com/nicobailon/pi-web-access
   Reload Pi resources with /construct reload or /reload when ready.
   ```
   Find this message a proper home: likely a post-submit summary screen, toast/status region, or normal command output after the TUI exits. Think through the loader/save lifecycle before patching; do not keep writing multi-line summaries into the footer.
4. [ ] Improve dashboard filtering so runtime skill/command inventory does not drown package loadout rows.
5. [ ] Decide how local-only rows behave in the one-menu model:
   - read-only with a hint to run `/construct sync`;
   - or selectable adoption from the same menu.
6. [ ] Tighten status/drift reporting for normalized local paths vs raw `.pi/settings.json` strings.
7. [ ] Add conflict/doctor visibility for overlapping runtime tool names and duplicate package/resource provenance; observed `npm:@ollama/pi-web-search` and `https://github.com/nicobailon/pi-web-access` both registering `web_search` in `~/Code/scratch-pi`.
8. [ ] Sweep old docs under `docs/` after the new one-menu direction settles. Keep historical notes if useful, but active docs should not advertise removed commands.

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
