# Audit Fix Plan

Date: 2026-06-18

## Goal

Clean up the Construct codebase after the code audit while keeping the MVP manual, explicit, and safe.

Primary outcomes:

- Fix concrete correctness issues first.
- Preserve forward-compatible library metadata.
- Reduce duplicated source/path handling.
- Remove dead/stale code.
- Add regression coverage for the risky cases.
- Keep the tree working after each increment.

## Execution notes

- We chose the explicit path: fix the concrete bugs, centralize shared operations, and document known limitations.
- Tests stay in existing smoke scripts for now because the additions are still focused and reasonably small.
- If future scenarios make `smoke.sh` or `e2e-smoke.sh` hard to scan, split a focused script rather than continuing to grow them.

## Completed task list

### Phase 1: Tests first for known bugs

- [x] Add regression for relative local source identity.
  - Covered by `scripts/e2e-smoke.sh` with `/construct load ./pkg`, dashboard ON check, unload, disable/enable/remove compatibility paths, and source-file preservation.
- [x] Add regression for catalog metadata preservation.
  - Covered by `scripts/smoke.sh`; verifies `groups` and arbitrary unknown item fields survive catalog add/remove writes.

### Phase 2: Fix concrete correctness issues

- [x] Fix relative `requestedSource` handling.
  - Added source identity helpers in `extensions/construct/sources.ts`.
  - State matching uses declared source plus normalized declared/requested identities.
  - Relative requested sources normalize against project cwd, not `.pi/`.
- [x] Preserve unknown catalog item fields.
  - `CatalogItem` is forward-compatible and includes explicit optional `groups`.
  - `parseCatalog()` keeps unknown fields for otherwise valid package items.

### Phase 3: DRY normalized package removal

- [x] Centralize normalized package declaration removal.
  - `removeMatchingPackageDeclaration()` now lives in `project-settings.ts`.
  - Unload, disable, and remove use the same normalized matching behavior.
- [x] Add regression for compatibility disable/remove with normalized local paths.
  - Covered by the relative source e2e scenario.

### Phase 4: Dead code cleanup

- [x] Remove dead/stale code.
  - Removed `handleUnloadAll()`.
  - Removed `planned()`.
  - Removed `syncProjectPackagesToCatalog()`.
  - Removed newly-unused stale helpers after refactor.

### Phase 5: Document intentional simple limitations

- [x] Document paths with spaces limitation.
  - README and commands/UX docs now state slash-command source parsing is simple and paths with spaces should use interactive/manual source input.

### Phase 6: Load/unload service extraction

- [x] Extract package operation service layer.
  - Added `extensions/construct/package-ops.ts`.
  - Multi-item load/unload/toggle/dashboard flows now call lower-level operations and summarize once instead of recursively calling full command handlers.

## Verification

Run and passed:

```bash
npm run check
npm run smoke
npm run e2e-smoke
npm run install-smoke
npm run invalid-drift-smoke
git diff --check
```

Additional static cleanup check:

```bash
rg -n "handleUnloadAll|planned\(|syncProjectPackagesToCatalog|removePackageDeclaration\(|updateConstructSourcesEnabled|packageSourceFromManagedItem" extensions/construct
```

Expected: no matches.

## Remaining manual check

Manual interactive TUI pass is still needed because automated print-mode smoke tests do not verify keyboard interaction:

- `/construct`
- `/construct load`
- `/construct unload`
- `/construct sync`

Check fuzzy typing, Space, Enter/save, Esc/cancel, section readability, and notification summaries.

## Watch-outs for future work

- Keep source identity helpers centralized; avoid reintroducing ad hoc raw-vs-normalized comparisons.
- If catalog/profile metadata grows, preserve unknown fields unless a migration intentionally drops them.
- Keep command handlers responsible for UI/output and package operation helpers responsible for file/package effects.
- Split smoke scripts if scenarios become hard to reason about.
