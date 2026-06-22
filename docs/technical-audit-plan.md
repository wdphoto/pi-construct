# Construct technical audit and discussion plan

Date: 2026-06-22
Branch audited: `review/code-audit-0.0.14`
Base: `v0.0.13` / `44ac751 Release 0.0.13`

This is a review/discussion document. It is not the committed roadmap. Move accepted work into `MAP.md` only after we choose a direction.

## Executive read

Construct is functionally healthy, but the bloat is real. The npm package is small; the weight is cognitive:

- saved-loadout code is concentrated in one 1,017-line command file;
- the generic TUI picker has become a mini framework;
- dashboard and saved-loadout run flows duplicate operation/progress/result logic;
- old design-plan docs now outnumber current source-of-truth docs;
- the next roadmap item (`/construct scan`) can stay lean only if it remains read-only and separate from the dashboard.

No release-blocking correctness failure showed up in automated checks. The strongest near-term bug risk was duplicate row identity in TUI selection when two remembered sources share the same derived id; this has now been fixed on the review branch.

My opinionated recommendation: finish this stabilization/trim pass before adding feature surface. The docs are consolidated, duplicate TUI ids are fixed, and a hygiene check exists; next, split saved-loadout and TUI operation code along the seams already visible in the implementation.

## Validation run

Passed:

```bash
npm run check
npm run smoke:all
npm audit --omit=dev
npm pack --dry-run
```

Extension-load smoke with disposable home/project passed:

```bash
REPO="$PWD"
TMP="$(mktemp -d)"
mkdir -p "$TMP/home" "$TMP/project"
(cd "$TMP/project" && HOME="$TMP/home" pi --no-extensions -e "$REPO" -p '/construct status' --approve)
```

Static hygiene probe found one issue:

```bash
npx tsc --noEmit --noUnusedLocals --noUnusedParameters --pretty false
# extensions/construct/commands/profiles.ts(611,33): error TS6133: 'tui' is declared but its value is never read.
```

Package size from dry-run:

```text
package size: 50.9 kB
unpacked size: 225.2 kB
files: 21
```

Code/documentation size snapshot:

```text
extensions/construct/*.ts total: 4,700 lines
largest source files:
- commands/profiles.ts      1,017
- commands/dashboard.ts       632
- ui.ts                       567
- commands/load.ts            462
- project-settings.ts         316

docs/*.md total before consolidation: 2,169 lines
active docs after consolidation: 1,093 lines
```

## What is healthy

- The public command surface remains intentionally small: `/construct`, `status`, `load`, `unload`, `autoload`, `save`, `list`, `run`, `share`, `remove`, `import`.
- `.pi/settings.json` remains source of truth; `.pi/construct.json` stays advisory.
- Mutating flows wait for idle before writes and re-read important JSON state near writes.
- JSON writes use temp-file + fsync + rename.
- Project `.pi/settings.json` direct edits create backups first.
- Package operations use Pi's public CLI contract for install/remove instead of private install internals.
- Direct resource inventory uses Pi's exported `DefaultPackageManager.resolve()` / `SettingsManager` model with `onMissing => "skip"`.
- Smoke coverage is broad for print/e2e/install/drift cases and disposable homes.
- Share/import safety rejects obvious secret-looking URLs and generated package cache paths.

## Findings and options

### A1 — Duplicate TUI row ids can still collapse selection — fixed on review branch

Severity: high for TUI correctness
Files: `extensions/construct/commands/dashboard.ts`, `extensions/construct/commands/unload.ts`, `extensions/construct/ui.ts`

Smoke coverage allows duplicate catalog ids with different sources, but TUI picker rows still use friendly ids as row ids in a few paths:

- dashboard package rows use `id: item.id`;
- `/construct unload` TUI picker rows use `id: item.id`.

If two remembered sources derive the same id, Space/Enter can select both as one logical checkbox or make one impossible to target.

Resolution:

- Dashboard and unload TUI picker ids now use stable internal row keys instead of visible package ids.
- Visible labels still use the friendly package/saved-loadout ids.
- Existing smoke coverage passes; full interactive duplicate-id selection still belongs in manual TUI verification until a TUI harness exists.

### A2 — `commands/profiles.ts` is doing too much

Severity: medium-high maintainability
File: `extensions/construct/commands/profiles.ts`

This one file owns save, list, run, share, remove, import parsing, paste UI, confirmation UIs, progress panels, snippet validation, source safety checks, and storage writes. The name is also stale in user-facing product language: `profile` is internal storage, but the feature is saved loadouts.

Options:

1. **Minimal rename/split**
   - `commands/saved-loadouts.ts` for command dispatcher.
   - Keep internal `CatalogProfile` type for storage compatibility.
   - Split helpers into `saved-loadouts/share.ts`, `saved-loadouts/import.ts`, `saved-loadouts/run.ts`, `saved-loadouts/save.ts`.

2. **Domain layer first**
   - Add `saved-loadouts.ts` domain module with pure helpers: id, lookup, sources, snippet validation, replacement diff.
   - Leave command UI functions in place temporarily.

3. **Do nothing until next saved-loadout feature**
   - Lowest churn, but it makes every future change harder.

Recommendation: option 2 first, then option 1 if the diff is clean. Do not add more saved-loadout behavior while this file stays at 1k lines.

### A3 — The generic checkbox picker is becoming a framework

Severity: medium maintainability
File: `extensions/construct/ui.ts`

`pickCheckboxes()` now handles filtering, section rendering, state-icon rendering, saved-row related markers, quick-select, remove confirmation, apply progress, cancellation, result panels, scrolling, and custom footer text.

That was a good incremental path, but it is now carrying dashboard-specific semantics through generic options.

Options:

1. **Keep it stable, extract only pure render helpers**
   - Lowest behavior risk.
   - Makes `ui.ts` easier to scan but does not reduce conceptual load much.

2. **Split picker phases**
   - `pickCheckboxes()` only selects/filters rows.
   - `showProgressPanel()` handles applying/result/reload panel.
   - `confirmPanel()` handles destructive confirmations.

3. **Move dashboard-specific row semantics out of picker**
   - Picker supports only generic `relatedIds` and `quickSelectIds`.
   - Dashboard owns all labels and action language.

Recommendation: option 2. It would also let saved-loadout run reuse the same progress/result panel instead of carrying a second custom implementation.

### A4 — Dashboard apply and saved-loadout run duplicate operation orchestration

Severity: medium maintainability / consistency
Files: `extensions/construct/commands/dashboard.ts`, `extensions/construct/commands/profiles.ts`, `extensions/construct/package-ops.ts`

Both flows build steps, wait for idle, apply package operations one at a time, track partial metadata failures, compute reload guidance, and render progress lines. They are close but not identical.

Recommendation:

- Extract a small operation runner, not a giant abstraction:
  - input: steps `{ action, label, source, direct? }`;
  - callback: progress lines;
  - output: completed, partial runtime changes, failures, needsReload, cancelled.
- Keep dashboard-specific step construction in `dashboard.ts`.
- Keep saved-loadout source expansion in saved-loadout code.

This is likely the best code-fat reduction per line changed.

### A5 — State collection is repeated across modules

Severity: medium maintainability / drift risk
Files: `dashboard.ts`, `load.ts`, `status.ts`, `profiles.ts`, `project-settings.ts`

Several modules independently collect package declarations, normalize local paths, match Construct metadata, detect disabled filters, and classify package state. The logic is readable in each place, but subtle differences are accumulating.

Options:

1. **Central snapshot module**
   - `state.ts` or `inventory.ts` returns a normalized `ConstructSnapshot` with packages, direct resources, catalog, metadata, warnings.
   - Dashboard/status/load/save consume the same classification helpers.

2. **Only extract source identity helpers**
   - Lower churn; keep callers separate.

3. **Leave until a bug appears**
   - The current smoke suite catches many drift cases.

Recommendation: start with option 2. A full snapshot module could become a second framework. Extract only the repeated identity/classification helpers that make duplicate/drift bugs likely.

### A6 — Static hygiene is close; add a cheap gate — fixed on review branch

Severity: low-medium
Files: `tsconfig.json`, `package.json`, `profiles.ts`

Strict TypeScript passes, but `noUnusedLocals/noUnusedParameters` is intentionally separate from the normal check.

Resolution:

- Fixed the unused parameter in `confirmRemoveSavedLoadout`.
- Added:
  ```json
  "check:hygiene": "tsc --noEmit --noUnusedLocals --noUnusedParameters --pretty false"
  ```
- Keep it separate from `npm run check` for now, while feature code is still moving.

### A7 — `readJson` conflates I/O errors with invalid JSON

Severity: low-medium correctness / diagnostics
File: `extensions/construct/json.ts`

`readJson()` returns `state: "invalid"` for parse failures and read failures alike. A permissions error, directory path, or transient filesystem error can be reported as “invalid JSON,” and some parse helpers treat invalid state as “empty plus warning.”

Options:

1. Add `state: "error"` to distinguish I/O failure from JSON parse failure.
2. Keep the type as-is but improve error copy: “could not read or parse JSON”.
3. Leave it; the practical user files are normal JSON files.

Recommendation: option 2 now, option 1 only if we touch JSON plumbing for another reason. Adding a union state is invasive.

### A8 — Autoload watcher may not be worth its code weight

Severity: product/maintenance decision
File: `extensions/construct/commands/autoload.ts`

Autoload is safe: off by default, trusted TUI only, confirmation-gated, and metadata-only. But the session watcher adds timing complexity, parent-path watch gaps, prompt annoyance risk, and around 250 lines of code around a non-core behavior.

Options:

1. **Polish the watcher**
   - Rebind to `.pi/settings.json` when `.pi/` appears.
   - Batch new declarations into one selectable prompt.
   - Add “ask on exit / ignore this session / turn off” choices.

2. **Downgrade autoload to exit-time only**
   - Delete watcher/debounce/seen-source state.
   - Keep the explicit `/construct autoload` toggle and quit-time prompt.
   - Simpler, less surprising, fewer modal interruptions.

3. **Keep as-is and document caveats**
   - No immediate work, but complexity remains.

Recommendation: seriously consider option 2. If Construct is feeling bloated, this is one of the few user-visible cuts that simplifies both code and mental model while preserving the core promise: “ask before adopting unloaded packages.”

### A9 — Package filter restoration remains an explicit product trade-off

Severity: medium product semantics
Files: `project-settings.ts`, `docs/architecture.md`, `docs/commands-and-ux.md`

Disabling a package overwrites package resource filters with `[]`; enabling removes those filter keys. This intentionally treats Construct as package-level on/off, but users who had partial filters lose that partial filter shape.

Options:

1. Keep whole-package enable/disable and make copy explicit.
2. Snapshot prior package filters into `.pi/construct.json` before disabling and restore on enable.
3. Add package-contained resource browsing/toggling.

Recommendation: option 1 for now. Option 2 is defensible later. Avoid option 3 unless Construct deliberately becomes a resource browser, which conflicts with the product lane.

### A10 — Known-project index is package-only while Construct now shows direct resources

Severity: low-medium product consistency
Files: `projects.ts`, `docs/product-model.md`, `docs/architecture.md`

Known-project assignment counts currently track package declarations only. That is okay because counts are informational and used mostly around unload/library cleanup. But direct resources are now first-class dashboard/status rows, so future “known projects” language can become misleading if reused around direct resources.

Recommendation:

- Keep package-only counts for now.
- Avoid showing known-project counts on direct-resource rows until the index stores resource refs.
- If `/construct scan` lands, design its report as read-only findings rather than expanding the known-project index implicitly.

### A11 — Project scan can easily become the next bloat source

Severity: product scope risk
Roadmap: `MAP.md` project scan section

`/construct scan [path]` is useful, but it must not become a second dashboard, a package manager, or a hidden broad resolver.

Options:

1. Conservative file scan:
   - parse `.pi/settings.json`, `.pi/construct.json`, and known `.pi/*` resource directories;
   - skip `node_modules`, `.git`, `.pi/npm`, `.pi/git`, build dirs;
   - no Pi package resolution, no trust writes, no installs.

2. Pi resolver per project:
   - more accurate, but risks trust/package side effects and slower scans.

3. No scan yet; rely on current project only.

Recommendation: option 1 only. Keep output summary-oriented and explicitly end with `No files were changed.` Do not integrate scan results into the dashboard in the first slice.

## Documentation audit

The active docs should now be small enough for agents and humans to load without wading through completed plans.

### Active source of truth after consolidation

- `AGENTS.md` — operating rules and product guardrails.
- `MAP.md` — current roadmap/action list; completed release history is summarized and points to `CHANGELOG.md`.
- `TODO.md` — scratchpad for undecided ideas only.
- `README.md` — user guide.
- `CHANGELOG.md` — shipped and unreleased history.
- `HANDOFF.md` — local session/release notes.
- `docs/product-model.md` — compact product model.
- `docs/commands-and-ux.md` — current command/UX reference.
- `docs/architecture.md` — architecture, data model, and Pi filter semantics.
- `docs/autoload-transparency.md` — current autoload behavior and watcher caveats.
- `docs/safety-and-maintenance.md` — safety rules and maintenance risks.
- `docs/preflight-checklist.md` — release/manual checklist.
- `docs/technical-audit-plan.md` — current audit discussion doc.

### Deleted as stale completed plans

The important current facts from these files were folded into the active docs above; shipped history remains in `CHANGELOG.md`.

- `docs/autoload-removal-plan.md`
- `docs/dashboard-action-model-plan.md`
- `docs/pi-model.md`
- `docs/profiles-and-sharing-plan.md`
- `docs/project-resource-loadout-plan.md`
- `docs/package-disable-design.md`
- `docs/pi-config-and-construct.md`

## Opinionated next work order

### Pass 1 — Stabilize before new features

1. Split saved-loadout pure helpers from `commands/profiles.ts`.
2. Extract shared operation/progress/result logic from dashboard and saved-loadout run.
3. Run `npm run check`, `npm run check:hygiene`, and `npm run smoke:all`.

### Pass 2 — Trim code

1. Extract saved-loadout pure helpers from `commands/profiles.ts`.
2. Extract shared operation runner/progress result logic from dashboard and saved-loadout run.
3. Split generic picker selection from apply/result panels.

### Pass 3 — Only then add `/construct scan`

Implement scan as a read-only file parser with conservative skips and no runtime adoption. Keep it out of the dashboard until the command proves useful.

## Decisions to discuss

1. Do we keep the autoload session watcher, or simplify autoload to exit-time only?
2. Should `profile` remain internal type/file language, or do we rename code modules to `saved-loadouts` while preserving JSON schema?
3. Is package-level filter loss acceptable long-term, or do we want a filter snapshot before disable?
