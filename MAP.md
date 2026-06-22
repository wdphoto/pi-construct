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
- [x] Split saved-loadout pure helpers out of the large command module.
- [x] Rename the saved-loadout command module away from stale profile terminology while preserving JSON schema compatibility.
- [x] Extract shared operation/progress/result handling used by dashboard apply and saved-loadout run.
- [x] Extract shared package source-set collection for raw/normalized declared, active, and disabled package declarations.
- [x] Extract small pure UI scroll/truncation helpers without changing picker behavior.
- [x] Simplify autoload to passive quit-time prompts only; remove the session watcher.

## v0.0.x — autoload polish

- [ ] Manually verify quit-time autoload prompt in trusted TUI sessions.
- [ ] Prefer a future public Pi package-install or settings-change event over filesystem watching if Pi exposes one.

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
- [x] Tighten verbose status reporting for normalized local package paths vs raw `.pi/settings.json` strings.
- [x] Add read-only verbose status visibility for effective runtime command/tool sources and duplicate public names.

## Later

- [ ] Consider lazy imports for heavier Construct modules if command code grows.
- [ ] Polish package source labels, especially local paths, toward short labels like `local:<name>` while preserving exact source strings in metadata.
- [ ] Keep package enable/disable whole-package for now; consider filter snapshots only if users need partial package-filter restoration.
- [ ] Review when saved loadouts/share snippets should include portable direct resources; current decision is package-source-only.
- [ ] Optional local-file packaging/export for `.pi/extensions`, prompts, skills, and themes.
- [ ] Optional parallel package installs/removals, but only after safe locking or merge semantics exist.
