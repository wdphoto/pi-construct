# Construct technical audit and discussion plan

Date: 2026-06-21  
Branch audited: `tui-cleanup`  
Scope: current Construct extension code, command flows, dashboard/TUI helper, autoload changes, smoke coverage, and active docs.

This is a discussion document, not the committed roadmap. Move accepted work into `MAP.md` when we decide to tackle it.

## Validation run

Passed:

```bash
git diff --check main...HEAD
npm run smoke:all
npm run release:verify
```

Secret scan found no checked-in credentials; hits were policy/doc text and local variable names only.

Extra static hygiene check:

```bash
npx tsc --noEmit --noUnusedLocals --noUnusedParameters --pretty false
```

Result: failed only on one unused import in `extensions/construct/commands/profiles.ts` (`parseCatalog`).

## What looks healthy

- The public command surface is still small: `/construct`, `status`, `load`, `unload`, `autoload`, and WIP profiles.
- `/construct status` remains read-only and does not create `.pi/construct.json`.
- `/construct load` and `/construct unload` preserve the intended source-of-truth boundary: `.pi/settings.json` wins, `.pi/construct.json` is advisory.
- Project settings edits create backups before direct writes.
- Autoload is opt-in, TUI/trusted-project only, and confirmation-gated.
- The dashboard state grammar is now simpler: selection marker plus state icon, with `Unloaded` read-only.
- The disposable smoke suite covers the main print/e2e/install/drift paths.

## Findings

### F1 — Partial runtime changes can be reported as failures without reload guidance

Severity: high  
Area: safety / user recovery  
Files: `extensions/construct/package-ops.ts`, `extensions/construct/commands/dashboard.ts`, `extensions/construct/commands/profiles.ts`

Package operations can change `.pi/settings.json` successfully, then fail while updating Construct metadata. Those results set `metadataOnlyFailure`, but dashboard/profile apply flows currently count only `result.ok` as a completed change. If every selected operation lands in this partial state, the final panel may show errors without the Enter-to-reload prompt even though runtime-affecting project settings changed.

Plan:

- Introduce a shared operation result shape with explicit flags like `changedProjectSettings`, `changedConstructMetadata`, `needsReload`, and `metadataWarning`.
- Treat metadata-only failures as partial success in user summaries.
- Reload prompt should be based on `needsReload`, not just `result.ok`.
- Apply the same result handling to dashboard apply and profile apply.

### F2 — Exit-time autoload does not preserve disabled-filter intent

Severity: high  
Area: correctness / drift  
File: `extensions/construct/commands/autoload.ts`

The session watcher passes `enabledBySource` into `loadSourcesIntoConstruct`, so a newly noticed disabled package is loaded with `enabled: false`. The quit-time fallback calls `loadSourcesIntoConstruct(ctx, paths, constructRead, sources)` without that map, so disabled package declarations can be adopted as `enabled: true`, creating immediate drift.

Plan:

- Build `enabledBySource` in `maybePromptAutoloadOnShutdown` from `candidate.disabledByFilters`.
- Add a regression fixture for disabled declarations loaded through the autoload fallback path, or at least a direct unit/pure helper test around candidate-to-enabled mapping.

### F3 — JSON writes are direct, not atomic

Severity: medium-high  
Area: data durability  
Files: `extensions/construct/json.ts`, all write callers

`writeJson` writes directly to the target file. An interrupted process can leave user library/settings/project metadata truncated or invalid. Direct `.pi/settings.json` edits have backups, but Construct user files and `.pi/construct.json` do not.

Plan:

- Replace `writeJson` internals with temp-file + rename in the same directory.
- Consider optional timestamped backups before destructive user-library writes such as `/construct unload` and profile overwrites.
- Keep `/construct status` read-only.

### F4 — Some file reads happen before idle waits and can become stale

Severity: medium  
Area: concurrency / correctness  
Files: `extensions/construct/commands/load.ts`, `extensions/construct/commands/dashboard.ts`, `extensions/construct/commands/profiles.ts`

Several flows inspect files, then wait for Pi/agent idle, then write using the earlier snapshot. If something else changes Construct metadata or settings while the command is waiting, a stale write can overwrite newer state.

Plan:

- Move final reads as close as possible to writes, after the idle wait.
- Re-read `.pi/construct.json` inside `loadSourcesIntoConstruct` or pass a thunk/read option instead of a pre-read snapshot.
- For dashboard apply, rebuild or validate selected package state immediately before applying if the wait was non-trivial.

### F5 — Autoload watcher has a known parent-path gap

Severity: medium  
Area: reliability  
Files: `extensions/construct/commands/autoload.ts`, `docs/autoload-transparency.md`

When `.pi/settings.json` does not exist at session start, the watcher falls back to `.pi/` or the project root. If `.pi/` is created after startup, the root watcher may notice the directory creation, but it does not rebind to `.pi/settings.json`; later settings-file writes can be missed until quit-time fallback.

Plan:

- Recompute and rebind the watch target after parent-directory creation or after any scheduled autoload check.
- Keep quit-time scan as the reliable fallback.
- Add a targeted manual or mocked watcher test for “project starts without `.pi/`, then package install creates it”.

### F6 — Duplicate catalog ids can collapse TUI selection

Severity: medium  
Area: TUI correctness  
Files: `extensions/construct/commands/dashboard.ts`, `extensions/construct/commands/unload.ts`, `extensions/construct/ui.ts`

Smoke coverage deliberately allows duplicate catalog ids with different sources. Some TUI picker rows still use `item.id` as the checkbox id, so duplicate ids can collapse selection state or make rows impossible to disambiguate in interactive flows.

Plan:

- Use a stable internal row id such as `${id}\0${source}` for picker identity.
- Keep the visible label as the friendly package id.
- Apply this to dashboard Available rows and `/construct unload` TUI rows first.

### F7 — Package filter toggles intentionally lose partial filter state

Severity: medium  
Area: product semantics / user trust  
Files: `extensions/construct/project-settings.ts`, `docs/package-disable-design.md`

Disabling overwrites all package resource filter keys with empty arrays. Enabling removes those keys. This is simple and documented, but it cannot restore a user’s prior partial package filters.

Plan:

- Decide whether this is acceptable for the near-term package-level model.
- If acceptable, keep copy explicit: Construct enables/disables the whole package, not individual resources.
- If not, store a filter snapshot in `.pi/construct.json` before disabling and restore it on enable.
- Avoid a fine-grained resource browser unless there is a deliberate product decision.

### F8 — Profiles remain WIP and use older flow patterns

Severity: medium  
Area: UX / consistency  
Files: `extensions/construct/commands/profiles.ts`, `MAP.md`

Profiles are still public-ish commands but remain WIP in docs. Profile apply uses the older status-line + summary flow rather than the newer in-panel dashboard progress/result flow, and it shares the partial-success reporting issue from F1.

Plan:

- Either keep profiles clearly WIP/secondary, or upgrade profile apply to the same progress/result/reload model as dashboard apply.
- Reuse shared operation result handling from F1.
- Consider folding profiles into the main dashboard only after the core package UI settles.

### F9 — Active docs still contain ambiguous autoload/startup wording

Severity: medium  
Area: docs / product clarity  
Files: `docs/autoload-removal-plan.md`, `docs/architecture.md`

The current implementation registers a session-start watcher when autoload is enabled. Some docs still say Construct has “no startup behavior.” The intended meaning is “no startup prompt/write/adoption,” but the wording is easy to misread now that a watcher attaches on session start.

Plan:

- Replace broad “no startup behavior” language with “no startup prompt, adoption, install, reload, or write.”
- State that opt-in autoload may attach a lightweight settings watcher on session start.

### F10 — The generic TUI picker is carrying a lot of behavior

Severity: low-medium  
Area: maintainability  
Files: `extensions/construct/ui.ts`, `extensions/construct/commands/dashboard.ts`

`pickCheckboxes` now owns filtering, section rendering, state icon rendering, remove confirmation, apply progress, cancellation, result panels, scrolling, and custom footer text. This is still workable, but it is becoming a small framework.

Plan:

- Keep it stable for the current dashboard pass.
- Later split pure rendering helpers from state machine/control-flow helpers.
- Keep dashboard-specific semantics in `dashboard.ts`; keep `ui.ts` generic.

### F11 — Static hygiene is light

Severity: low  
Area: maintainability  
Files: `tsconfig.json`, `extensions/construct/commands/profiles.ts`

Strict TypeScript is on, but unused imports/locals are not part of the normal check. A one-off no-unused run caught one unused import.

Plan:

- Remove the unused `parseCatalog` import.
- Consider adding `noUnusedLocals` / `noUnusedParameters` to `npm run check`, or add a separate `npm run check:hygiene` if that is too strict while features are WIP.

### F12 — Test coverage is good for print/e2e, thin for real TUI/autoload watcher behavior

Severity: low-medium  
Area: test coverage  
Files: `scripts/*.sh`

The smoke suite gives strong disposable-home coverage for print-mode command behavior, install discovery, duplicate/drift cases, and package disable detection. It does not exercise real interactive TUI key handling, watcher timing, confirm prompts, or partial operation failures.

Plan:

- Keep current smoke suite as the release baseline.
- Add pure helper tests for source identity, dashboard package classification, and operation-result aggregation.
- Add a manual TUI checklist before merge/release until we have an automated TUI harness.
- Add a targeted autoload watcher/quit fallback test only if Pi exposes a stable way to drive confirmations.

### F13 — Branch history contains superseded color experiments

Severity: low  
Area: release hygiene  
Branch: `tui-cleanup`

The branch has commits for row color experiments that were later backed out to icon-only coloring. That is fine for exploration, but noisy for merge history.

Plan:

- Before merging to `main`, squash or rebase into coherent commits, likely:
  1. autoload transparency/watcher behavior;
  2. dashboard layout/state grammar;
  3. docs/smoke updates.

## Proposed tackle order

### Pass 1 — Correctness before merge

1. Fix F2: preserve disabled metadata in quit-time autoload.
2. Fix F1: make partial runtime changes visible and reload-worthy.
3. Fix F9/F11: clear stale doc wording and unused import.
4. Run `npm run smoke:all` and `npm run release:verify`.

### Pass 2 — Data safety and identity hardening

1. Implement atomic JSON writes (F3).
2. Move final reads after idle waits where practical (F4).
3. Use composite picker ids for duplicate-friendly TUI rows (F6).
4. Add focused regression coverage for each.

### Pass 3 — UX/product decisions

1. Decide whether package filter restoration matters now (F7).
2. Decide profile WIP direction: upgrade or keep secondary (F8).
3. Finish manual real-TUI review: spacing, cursor movement, filter clarity, footer wrapping, remove confirmation, result reload.

### Pass 4 — Maintenance polish

1. Refactor `ui.ts` only after behavior settles (F10).
2. Add static hygiene checks if we want them in CI/release gates (F11).
3. Squash/rebase `tui-cleanup` before merge (F13).

## Open discussion questions

- Should metadata-only failures still trigger reload by default, or should the result panel offer “reload recommended” without auto-Enter reload?
- Do we want Construct to preserve partial Pi package filters, or is whole-package enable/disable the correct product boundary for now?
- How much effort should go into automated TUI testing versus keeping a manual checklist?
- Should profiles graduate into the dashboard soon, or stay WIP until copy/import lands?
