# Construct technical audit and discussion plan

Date: 2026-06-22
Branch audited: `review/code-audit-0.0.14`
Base: `v0.0.13` / `44ac751 Release 0.0.13`

This is a review/discussion document. It is not the committed roadmap. Move accepted work into `MAP.md` only after we choose a direction.

## Executive read

Construct is functionally healthy, but the bloat is real. The npm package is small; the weight is cognitive:

- saved-loadout command code is still large, but pure helpers and shared operation plumbing are now split out;
- the generic TUI picker has become a mini framework;
- dashboard and saved-loadout run flows now share operation/progress/result execution code;
- old design-plan docs now outnumber current source-of-truth docs;
- the next roadmap item (`/construct scan`) can stay lean only if broad discovery remains conservative and selected TUI loading keeps `/construct load` write boundaries.

No release-blocking correctness failure showed up in automated checks. The strongest near-term bug risk was duplicate row identity in TUI selection when two remembered sources share the same derived id; this has now been fixed on the review branch.

My opinionated recommendation: pause for review before adding feature surface. The docs are consolidated, duplicate TUI ids are fixed, hygiene is clean, saved-loadout helpers are split, dashboard/run operation plumbing is shared, and postponed autoload behavior is hidden from the public surface.

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

Static hygiene now passes:

```bash
npm run check:hygiene
```

Package size from dry-run:

```text
package size: 50.9 kB
unpacked size: 225.2 kB
files: 21
```

Code/documentation size snapshot:

```text
extensions/construct/*.ts total: 4,770 lines
largest source files:
- commands/saved-loadouts.ts  766
- commands/dashboard.ts       584
- ui.ts                       567
- commands/load.ts            462
- project-settings.ts         338

docs/*.md total before consolidation: 2,169 lines
active docs after consolidation: 1,093 lines
```

## What is healthy

- The public command surface remains intentionally small: `/construct`, `status`, `scan`, `load`, `unload`, `save`, `list`, `run`, `share`, `wipe`, `import`.
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

### A2 — saved-loadout command code is still large — partially fixed on review branch

Severity: medium-high maintainability
File: `extensions/construct/commands/saved-loadouts.ts`

This command module still owns save, list, run, share, remove, import parsing, paste UI, confirmation UIs, snippet validation, source safety checks, and storage writes. It is smaller after extracting pure helpers and shared operation plumbing, and the stale command filename has been renamed from `profiles.ts` to `saved-loadouts.ts`. Internal `CatalogProfile` and `profiles` JSON fields remain storage compatibility terms.

Resolution so far:

- Added `extensions/construct/saved-loadouts.ts` for pure saved-loadout/share/import helpers.
- Added `extensions/construct/operation-runner.ts` for shared progress/result execution.
- Renamed the command module to `commands/saved-loadouts.ts` and exported `handleSavedLoadoutCommand()`.

Deferred option: split the command module further by action (`save`, `run`, `share`, `import`) only when another saved-loadout feature needs those seams. Do not add more saved-loadout behavior while this module remains broad.

### A3 — The generic checkbox picker is becoming a framework — pure scroll helpers extracted on review branch

Severity: medium maintainability
File: `extensions/construct/ui.ts`

`pickCheckboxes()` now handles filtering, section rendering, state-icon rendering, saved-row related markers, quick-select, remove confirmation, apply progress, cancellation, result panels, scrolling, and custom footer text.

That was a good incremental path, but it is now carrying dashboard-specific semantics through generic options.

Resolution so far:

- Added small pure `scrollWindow()` and `truncateLines()` helpers used by summary, confirmation, and apply panels.
- Kept picker phases and behavior intact; no TUI interaction semantics changed.

Deferred option: split `pickCheckboxes()` into selection, confirmation, and progress/result panels only if the picker keeps growing or a TUI harness makes the behavior safer to refactor.

### A4 — Dashboard apply and saved-loadout run duplicate operation orchestration — fixed on review branch

Severity: medium maintainability / consistency
Files: `extensions/construct/commands/dashboard.ts`, `extensions/construct/commands/saved-loadouts.ts`, `extensions/construct/package-ops.ts`

Both flows used to build steps, wait for idle, apply package operations one at a time, track partial metadata failures, compute reload guidance, and render progress lines independently.

Resolution:

- Added `extensions/construct/operation-runner.ts` with a small operation runner and shared progress/result panel plumbing.
- Dashboard-specific step construction remains in `dashboard.ts`.
- Saved-loadout source expansion remains in saved-loadout command code and shared helpers.
- Public command behavior and command surface are unchanged.

### A5 — State collection is repeated across modules — source-set helper extracted on review branch

Severity: medium maintainability / drift risk
Files: `dashboard.ts`, `load.ts`, `status.ts`, `saved-loadouts.ts`, `project-settings.ts`

Several modules independently collect package declarations, normalize local paths, match Construct metadata, detect disabled filters, and classify package state. The logic is readable in each place, but subtle differences are accumulating.

Resolution so far:

- Added `collectPackageSourceSets()` in `project-settings.ts` for raw+normalized declared/active/disabled package source sets.
- Wired it into dashboard, status, saved-loadout save, and unload checks where the existing semantics matched.
- Added normalized local source details to verbose status package declaration lines so raw relative settings strings are easier to compare with Construct metadata.
- Avoided a full central snapshot module; callers still own their command-specific classification and UI behavior.

Deferred option: extract more identity helpers only when duplication causes a real bug or a future feature needs it. Avoid turning this into a broad inventory framework.

### A6 — Static hygiene is close; add a cheap gate — fixed on review branch

Severity: low-medium
Files: `tsconfig.json`, `package.json`, `saved-loadouts.ts`

Strict TypeScript passes, but `noUnusedLocals/noUnusedParameters` is intentionally separate from the normal check.

Resolution:

- Fixed the unused parameter in `confirmRemoveSavedLoadout`.
- Added:
  ```json
  "check:hygiene": "tsc --noEmit --noUnusedLocals --noUnusedParameters --pretty false"
  ```
- Keep it separate from `npm run check` for now, while feature code is still moving.

### A7 — `readJson` conflates I/O errors with invalid JSON — copy fixed on review branch

Severity: low-medium correctness / diagnostics
File: `extensions/construct/json.ts`

`readJson()` still uses the existing `state: "invalid"` union member for both parse failures and read failures to avoid invasive plumbing churn. User-facing copy now says files “could not be read or parsed as JSON,” and status reports `invalid/unreadable JSON` instead of implying every failure is a syntax error.

Deferred option: add a distinct `state: "error"` only if future JSON plumbing work needs code-level branching between parse and I/O failures.

### A8 — Autoload is postponed and hidden from the public surface

Severity: product/maintenance decision
File: deleted `extensions/construct/commands/autoload.ts`

Autoload was safe in design but non-core: even confirmation-gated exit prompts added product surface, timing questions, and docs weight around behavior users did not explicitly need.

Resolution:

- Removed the session-time `.pi/settings.json` filesystem watcher in the earlier cleanup.
- Hid the remaining autoload command/hook from the public command surface.
- Removed the dormant autoload command module.
- Removed active user-facing autoload docs.

Deferred option: revisit only if users ask for it, and preferably only if Pi later exposes a public package-install or settings-change event.

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
- `/construct scan` now reports conservative findings and does not expand the known-project index implicitly.

### A11 — Project scan can easily become the next bloat source

Severity: product scope risk
Roadmap: `MAP.md` project scan section

`/construct scan [path]` is useful, but it must not become a second dashboard, a package manager, or a hidden broad resolver. The first implementation intentionally landed as option 1 below, with no-arg trust-store scanning, explicit path override, and trusted-project-only scanning.

Options:

1. Conservative file scan:
   - parse `.pi/settings.json`, `.pi/construct.json`, and known `.pi/*` resource directories;
   - skip `node_modules`, `.git`, `.pi/npm`, `.pi/git`, build dirs;
   - no Pi package resolution, no trust writes, no installs.

2. Pi resolver per project:
   - more accurate, but risks trust/package side effects and slower scans.

3. No scan yet; rely on current project only.

Decision: option 1 only. With no path, scan trusted Pi paths from the trust store while refusing broad/private roots; with a path, scan that explicit root. In both modes, scan only Pi-trusted projects and keep print output summary-oriented. TUI scan may load selected findings using `/construct load` write boundaries.

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

### Pass 1 — Stabilize before new features — done on review branch

1. Split saved-loadout pure helpers from the saved-loadout command module.
2. Extract shared operation/progress/result logic from dashboard and saved-loadout run.
3. Run `npm run check`, `npm run check:hygiene`, and `npm run smoke:all`.

### Pass 2 — Optional trim after review

1. Split generic picker selection from apply/result panels if the picker keeps growing.

### Pass 3 — Add `/construct scan` — done on feature branch

Scan is implemented as a read-only file parser with conservative skips and no runtime adoption. Keep it out of the dashboard until the command proves useful.

## Decisions to discuss

1. Should remaining `profile` storage type/field language ever be renamed, or should it remain compatibility-only internals?
2. Is package-level filter loss acceptable long-term, or do we want a filter snapshot before disable?
