# TODO

Current work should keep the MVP manual, explicit, and boring-safe. Do not add lifecycle/startup automation unless we deliberately reopen that design.

## Now / next

- [ ] Manual interactive TUI pass:
  - `/construct`
  - `/construct load`
  - `/construct unload`
  - multi-item `/construct sync`
  - Verify fuzzy typing/filtering, Space toggles, Enter saves, Esc cancels, and readable section headers.
- [ ] Make `/construct` command output prettier and easier to scan:
  - status, sync, library, load, unload, toggle, and dashboard;
  - clearer headings, spacing, success/error states, and next-step hints;
  - default completion notification sound should be a dinner bell, if Pi/terminal notification APIs support it.
- [ ] Sweep docs and command output for stale language:
  - prefer `library`, `remember`, `forget`, `toggle`, `loadout`, `Construct-managed`, `local-only`, `adopted`;
  - keep `catalog` only for `catalog.json` internals and compatibility notes;
  - keep `wipe`, `autoload`, and `autosync` only in historical/removal notes.
- [ ] Improve status/drift reporting for normalized local paths vs raw `.pi/settings.json` strings.
- [ ] Add conflict/doctor visibility for loaded packages that register overlapping tool names; observed `npm:@ollama/pi-web-search` and `https://github.com/nicobailon/pi-web-access` both registering `web_search` in `~/Code/scratch-pi`.
- [ ] Later: support Pi package filters as a conflict-resolution/fine-grained toggle layer, e.g. keep a package declared but set `extensions: []`, `skills: []`, `prompts: []`, or `themes: []` instead of unloading the whole package.
- [ ] Decide whether hidden compatibility commands (`on`, `off`, old `enable`/`disable`/`remove`) stay long-term or become debug-only documentation.

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

- Collapse or summarize runtime skill command rows in `/construct` so large skill packages do not flood the dashboard; keep them read-only/inventory-only.
- Friendly first-run/never-loaded messaging for projects with no `.pi/construct.json`, triggered only by an explicit `/construct` command.
- Optional onboarding/startup automation behind an explicit opt-in toggle.
- Item action menu: load, unload, forget, cancel.
- Groups/profiles as lists of remembered library source ids.
- Better package-backed skill visibility while keeping runtime skill/command rows read-only until package-level UX feels solid.
