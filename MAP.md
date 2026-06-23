# MAP

Roadmap and action list for The Construct. Scratch/research notes live in `TODO.md`; shipped history lives in `CHANGELOG.md`.

## Completed through v0.0.13

Construct has shipped the core loadout loop:

- `/construct` dashboard with `Loadouts`, `Active`, `Disabled`, `Available`, and `Unloaded` rows;
- manual `/construct load` and `/construct unload` boundaries;
- known-project counts;
- saved loadouts: `save`, `list`, `run`, `share`, `wipe`, and `import`;
- direct project resource inventory/adoption/toggle support for project extensions, skills, prompt templates, and themes;
- package-source-only saved loadouts/share snippets.

See `CHANGELOG.md` for version-by-version detail.

## v0.0.x — review branch cleanup

- [x] Run a fresh code/docs audit after `v0.0.13`; see `docs/technical-audit-plan.md`.
- [x] Consolidate stale planning docs into current source-of-truth docs.
- [x] Fix duplicate TUI row identity for remembered sources with the same derived id.
- [x] Add a cheap TypeScript hygiene check for unused locals/parameters.
- [x] Split saved-loadout pure helpers out of the large command module.
- [x] Rename the saved-loadout command module away from stale profile terminology while preserving JSON schema compatibility.
- [x] Extract shared operation/progress/result handling used by dashboard apply and saved-loadout run.
- [x] Extract shared package source-set collection for raw/normalized declared, active, and disabled package declarations.
- [x] Extract small pure UI scroll/truncation helpers without changing picker behavior.
- [x] Simplify autoload to passive quit-time prompts only; remove the session watcher.
- [x] Hide postponed autoload behavior from the public command/docs surface and remove the dormant command module.

## v0.0.x — project scan

- [x] Add `/construct scan [path]` as a report for unloaded project-level Pi resources under trusted Pi paths or an explicit folder.
- [x] Detect Pi projects by `.pi/settings.json`, `.pi/construct.json`, and project-local `.pi/extensions`, `.pi/skills`, `.pi/prompts`, or `.pi/themes` resources.
- [x] Report package declarations not in the Construct library/current project metadata and direct project-local resources not adopted into that project's `.pi/construct.json`.
- [x] Scan only Pi-trusted projects; list and skip untrusted projects and overly broad/private trusted roots.
- [x] Keep print-mode scan strictly read-only; in TUI mode, selected findings can be loaded into Construct with the same write boundaries as `/construct load`.
- [x] Avoid expensive/noisy directories such as `node_modules`, `.git`, `.pi/npm`, `.pi/git`, `dist`, and `build`.
- [x] Prefer conservative file parsing for scan over Pi runtime resolution unless a safe public resolver mode is confirmed.
- [x] Keep print-mode output summary-oriented and end with `No files were changed.`
- [x] Visually group scan findings by resource type so package declarations are distinct from direct project extensions, skills, prompts, themes, and drift.

## v0.0.x — dashboard/status polish

- [x] Clean up `/construct` TUI vocabulary: call saved recipes **Loadouts** in the dashboard, because the saved thing is a Construct loadout; package rows are package/resource toggles, not saved things.
- [ ] Continue dashboard UI/key polish opportunistically as the workflow evolves.
- [x] Manually verify dashboard action keys in TUI: Space selects, Enter applies/runs, `r` confirms/removes, result-panel Enter reloads.
- [x] Tighten verbose status reporting for normalized local package paths vs raw `.pi/settings.json` strings.
- [x] Add read-only verbose status visibility for effective runtime command/tool sources and duplicate public names.
- [x] Add quiet first-run dashboard messaging when a project has no `.pi/construct.json`; this is informational only and does not create metadata.
- [x] Add read-only `/construct status full` visibility for project package-contained resources as the first package-plucking research step.

## v0.0.x — inventory/reconciliation cleanup

- [x] Centralize package metadata drift wording so scan, status, and dashboard stay aligned.
- [x] Extract a small project inventory module for shared package/direct-resource reconciliation.
- [x] Move command-specific callers onto the shared inventory where it fits; dashboard, status, save, and load candidate discovery now use it, while scan stays conservative file parsing and load still owns its write operations.
- [x] Keep the inventory interface read-only; route all writes through existing load/dashboard operation helpers.
- [x] Keep package-internal resource browsing/filter recipes out of this cleanup; treat that as a separate product design if needed.

## v0.0.x — decision cleanup

Completed as a small no-new-command cleanup pass. The goal was to turn remaining product questions into explicit documented decisions, not to add feature surface.

- [x] Decide and document package filter restoration policy.
  - Decision: keep Construct package toggles whole-package only for unfiltered or whole-package-disabled declarations for now.
  - Do not snapshot/restore partial Pi package filters yet.
  - Construct refuses whole-package toggles for already-partial package filters instead of silently clobbering native resource-level selections.
- [x] Decide and document saved-loadout direct-resource policy.
  - Decision: keep saved loadouts/share snippets package-source-only.
  - Direct project-local resources remain project-local Construct metadata only.
  - Do not design a portable direct-resource export/import format yet.
- [x] Add stale known-project visibility without adding a command.
  - Do not add `/construct doctor` yet.
  - `/construct status full` shows lightweight missing-path notes for known-project entries whose paths no longer exist.
  - Do not prune known-project entries automatically yet.
- [x] Decide and document known-project dashboard count policy.
  - Decision: keep known-project counts out of dashboard rows for now.
  - Counts remain informational in status/unload contexts only; the index is package-only and not full filesystem usage.

## v0.0.x — package resource picker

Plan: `docs/package-resource-picker-plan.md`. Research: `docs/package-resource-plucking-research.md`.

- [x] Research Pi-native package resource plucking through package filters.
- [x] Add read-only `/construct status full` visibility for project package-contained resources.
- [x] Add package filter reader/planner module and smoke coverage.
- [x] Recalibrate whole-package toggles so partial filters are not silently clobbered.
- [x] Add read-only dashboard package-row drill-down.
- [x] Add write-enabled package resource picker that writes Pi package filters after confirmation.
- [x] Extend package resource picking to Available rows: lazily inspect remembered sources with Pi's temporary resolver from Right Arrow, then install project-local with selected resources only.
- [x] Keep `r` remove package-level only; package child rows are filtered, not removed individually.
- [x] Hide the child-resource unfold affordance for packages with zero or one resolved package resource.
- [x] Delay the lazy inspection loading panel so cached Available package inspections do not flash.
- [x] Treat package child-resource selection as an explicit allowlist so future package-added resources stay disabled until selected.
- [ ] Polish the child-row UI so hierarchy and changed target state are clearer.
- [ ] Defer saved-loadout filter recipes until there is explicit product demand.

## Later

- [x] Lazy-load heavier Construct command modules from the entrypoint so completions/unknown commands stay light.
- [x] Polish package source labels in the dashboard, especially local paths, toward short labels like `local:<name>` while preserving exact source strings in metadata.
- [ ] Optional local-file packaging/export for `.pi/extensions`, prompts, skills, and themes.
- [ ] Optional parallel package installs/removals, but only after safe locking or merge semantics exist.
- [ ] Revisit autoload only if there is clear demand and preferably a future public Pi package-install or settings-change event.
