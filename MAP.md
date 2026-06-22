# MAP

Roadmap and action list for The Construct. Scratch/research notes live in `TODO.md`; shipped history lives in `CHANGELOG.md`.

## Completed through v0.0.13

Construct has shipped the core loadout loop:

- `/construct` dashboard with `Saved`, `Active`, `Disabled`, `Available`, and `Unloaded` rows;
- manual `/construct load` and `/construct unload` boundaries;
- known-project counts;
- explicit `/construct autoload` with confirmation-only adoption prompts;
- saved loadouts: `save`, `list`, `run`, `share`, `remove`, and `import`;
- direct project resource inventory/adoption/toggle support for project extensions, skills, prompt templates, and themes;
- package-source-only saved loadouts/share snippets.

See `CHANGELOG.md` for version-by-version detail.

## v0.0.x — review branch cleanup

- [x] Run a fresh code/docs audit after `v0.0.13`; see `docs/technical-audit-plan.md`.
- [x] Consolidate stale planning docs into current source-of-truth docs.
- [x] Fix duplicate TUI row identity for remembered sources with the same derived id.
- [x] Add a cheap TypeScript hygiene check for unused locals/parameters.
- [ ] Split saved-loadout pure helpers out of the large command module.
- [ ] Extract shared operation/progress/result handling used by dashboard apply and saved-loadout run.
- [ ] Decide whether autoload keeps the session watcher or simplifies to exit-time only.

## v0.0.x — autoload polish

- [ ] Manually verify autoload settings-watcher prompts in TUI.
- [ ] If keeping the watcher, consider richer choices: load now, ask on exit, ignore this session, turn autoload off.
- [ ] If keeping the watcher, consider batching multiple newly declared packages into one selectable prompt.
- [ ] If keeping the watcher, rebind directly to `.pi/settings.json` when the file appears after session start.
- [ ] Prefer a future public Pi package-install/settings-change event over filesystem watching if Pi exposes one.

## v0.0.x — project scan

- [ ] Add `/construct scan [path]` as an explicit read-only report for unloaded project-level Pi resources under a folder, defaulting to `~/Code`.
- [ ] Detect Pi projects by `.pi/settings.json`, `.pi/construct.json`, and project-local `.pi/extensions`, `.pi/skills`, `.pi/prompts`, or `.pi/themes` resources.
- [ ] Report package declarations not in the Construct library/current project metadata and direct project-local resources not adopted into that project's `.pi/construct.json`.
- [ ] Keep scan strictly read-only: no install, load, trust change, package execution, reload, or writes.
- [ ] Avoid expensive/noisy directories such as `node_modules`, `.git`, `.pi/npm`, `.pi/git`, `dist`, and `build`.
- [ ] Prefer conservative file parsing for scan over Pi runtime resolution unless a safe public resolver mode is confirmed.
- [ ] Keep output summary-oriented and end with `No files were changed.`

## v0.0.x — dashboard/status polish

- [ ] Manually verify dashboard action keys in TUI: Space selects, Enter applies/runs, `r` confirms/removes, result-panel Enter reloads.
- [ ] Tighten status/drift reporting for normalized local paths vs raw `.pi/settings.json` strings.
- [ ] Add conflict/doctor visibility for overlapping runtime tool names and duplicate package/resource provenance.

## Later

- [ ] Consider lazy imports for heavier Construct modules if command code grows.
- [ ] Polish package source labels, especially local paths, toward short labels like `local:<name>` while preserving exact source strings in metadata.
- [ ] Keep package enable/disable whole-package for now; consider filter snapshots only if users need partial package-filter restoration.
- [ ] Review when saved loadouts/share snippets should include portable direct resources; current decision is package-source-only.
- [ ] Optional local-file packaging/export for `.pi/extensions`, prompts, skills, and themes.
- [ ] Optional parallel package installs/removals, but only after safe locking or merge semantics exist.
