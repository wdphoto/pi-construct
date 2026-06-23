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

## v0.0.x — inventory/reconciliation cleanup

- [x] Centralize package metadata drift wording so scan, status, and dashboard stay aligned.
- [x] Extract a small project inventory module for shared package/direct-resource reconciliation.
- [x] Move command-specific callers onto the shared inventory where it fits; dashboard, status, save, and load candidate discovery now use it, while scan stays conservative file parsing and load still owns its write operations.
- [x] Keep the inventory interface read-only; route all writes through existing load/dashboard operation helpers.
- [x] Keep package-internal resource browsing/filter recipes out of this cleanup; treat that as a separate product design if needed.

## v0.0.x — decision cleanup next

Do this as a small no-new-command cleanup pass. The goal is to turn remaining product questions into explicit documented decisions, not to add feature surface.

- [x] Decide and document package filter restoration policy.
  - Decision: keep Construct package toggles whole-package only for now.
  - Do not snapshot/restore partial Pi package filters yet.
  - Docs and dashboard confirmation copy are explicit: disabling a package writes empty resource filters; enabling removes those filters; users needing partial package resource selection should use Pi settings directly for now.
- [x] Decide and document saved-loadout direct-resource policy.
  - Decision: keep saved loadouts/share snippets package-source-only.
  - Direct project-local resources remain project-local Construct metadata only.
  - Do not design a portable direct-resource export/import format yet.
- [ ] Add stale known-project visibility without adding a command.
  - Do not add `/construct doctor` yet.
  - Add lightweight missing-path notes to `/construct status full` for known-project entries whose paths no longer exist.
  - Do not prune known-project entries automatically yet.

## Later

- [x] Lazy-load heavier Construct command modules from the entrypoint so completions/unknown commands stay light.
- [x] Polish package source labels in the dashboard, especially local paths, toward short labels like `local:<name>` while preserving exact source strings in metadata.
- [ ] Optional local-file packaging/export for `.pi/extensions`, prompts, skills, and themes.
- [ ] Optional parallel package installs/removals, but only after safe locking or merge semantics exist.
- [ ] Revisit autoload only if there is clear demand and preferably a future public Pi package-install or settings-change event.
