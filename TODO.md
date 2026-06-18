# TODO

Current work should keep the MVP manual, explicit, and boring-safe. Do not add lifecycle/startup automation unless we deliberately reopen that design.

## Now / next

- [ ] Manual interactive TUI pass:
  - `/construct`
  - `/construct load`
  - `/construct unload`
  - multi-item `/construct sync`
  - Verify fuzzy typing/filtering, Space toggles, Enter saves, Esc cancels, and readable section headers.
- [ ] Polish command output for status, sync, library, load, unload, toggle, and dashboard.
- [ ] Sweep docs and command output for stale language:
  - prefer `library`, `remember`, `forget`, `toggle`, `loadout`, `Construct-managed`, `local-only`, `adopted`;
  - keep `catalog` only for `catalog.json` internals and compatibility notes;
  - keep `wipe`, `autoload`, and `autosync` only in historical/removal notes.
- [ ] Improve status/drift reporting for normalized local paths vs raw `.pi/settings.json` strings.
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

- Friendly first-run/never-loaded messaging for projects with no `.pi/construct.json`, triggered only by an explicit `/construct` command.
- Optional onboarding/startup automation behind an explicit opt-in toggle.
- Item action menu: load, unload, forget, cancel.
- Groups/profiles as lists of remembered library source ids.
- Better package-backed skill visibility while keeping runtime skill/command rows read-only until package-level UX feels solid.
