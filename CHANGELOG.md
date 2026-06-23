# Changelog

All notable changes to the Construct will be documented here.

This project is currently pre-1.0. Released changes are tagged from `0.0.1` onward.

## Unreleased

### Added
- Show read-only project package internals in `/construct status full` as groundwork for future dashboard package-resource inspection.
- Add native Pi package-filter analysis so Construct can recognize unfiltered, whole-package-disabled, partial, and invalid package filter states.

### Changed
- Refuse whole-package enable/disable edits when a package already has partial Pi package filters, so Construct does not silently clobber resource-level selections.

## 0.0.19 - 2026-06-23

### Changed
- Postponed autoload and removed it from the public command/help/docs surface, including the dormant command module.
- Started the inventory cleanup by moving shared dashboard/status/save/load candidate reconciliation into a read-only inventory module.
- Made the printed dashboard footer hint match the current project state instead of always suggesting `/construct load`.
- Lazy-load heavier Construct command modules from the entrypoint so completions and unknown-command help stay light.
- Shorten dashboard package source labels for local paths to `local:<name>` while keeping exact source strings in metadata and write operations.
- Document package toggles as whole-package operations and make dashboard disable confirmation explicit about not preserving partial package filters.
- Document saved loadouts/share snippets as package-source-only, with direct project resources staying project-local metadata.
- Show missing known-project paths in `/construct status full` without adding a new cleanup/doctor command or pruning automatically.
- Document that known-project counts stay out of dashboard rows and remain limited to status/unload contexts.
- Add a quiet `/construct` dashboard hint for projects with no Construct metadata yet, without creating `.pi/construct.json`.

## 0.0.18 - 2026-06-23

### Added
- Document why scan does not crawl old package cache skills/extensions and how to distinguish package-provided resources from direct project resources.
- Show package/version copy such as `pi-construct@0.0.18` in dashboard and status headers for easier bug reports.

### Changed
- Polish the `/construct` loadout dashboard wording, markers, footer, row colors, and loadout vocabulary.
- Show unloaded active package declarations as `[!]` read-only rows in the dashboard until explicitly loaded into Construct.
- Update saved loadout recipe rows to use `Loadouts` and `[·] recipe item` wording.
- Make `/construct save <loadout-name>` show active Construct-managed packages as already included, and active unloaded package declarations as optional load/include rows in TUI.
- Group `/construct save` summaries into included, loaded, and not-included sections, including direct project-local resource warnings.

## 0.0.17 - 2026-06-23

### Fixed
- Report disabled Construct metadata that is missing from `.pi/settings.json` as drift in `/construct status` and `/construct scan`.
- Show drifted Construct metadata as a first-class `/construct scan` section instead of burying it in warnings.
- Show drift-only scan results in the TUI checklist so selected stale metadata can be reconciled instead of ending at a read-only warning.
- Group scan findings by type so package declarations are visually distinct from direct project extensions, skills, prompts, themes, and drift.
- Add `FAQ.md` as the troubleshooting home for drift, reconcile, and edge-case recovery notes.
- Warn on the dashboard when available rows are actually stale project metadata missing from `.pi/settings.json`.
- Confirm before disabling selected active dashboard resources, so a restored loadout cannot be filtered off by one unguarded Enter press.
- Rename saved recipe deletion from `/construct remove <name>` to `/construct wipe <name>`, leaving “remove” to mean dashboard project package removal only.
- Clarify dashboard remove confirmation: `r` removes selected package declarations from the current project, while `/construct wipe <name>` deletes saved loadout recipes only.
- Remove matching project Construct metadata when dashboard project removal removes package declarations, so normal Construct removal does not leave stale drift behind.
- Re-arm disabled project metadata from `/construct load` when the matching package declaration is active in `.pi/settings.json`.

## 0.0.16 - 2026-06-22

### Changed
- Changed the `/construct scan` TUI checklist so Enter loads selected findings into Construct instead of only showing load guidance.

## 0.0.15 - 2026-06-22

### Added
- Added `/construct scan [path]`, a read-only trusted local project report for unloaded package declarations and direct project `.pi/` resources.
- Added a TUI scan review checklist with lightweight progress and selected-item load guidance.

### Changed
- Clarified README saved-loadout recipe update and removal behavior.

## 0.0.14 - 2026-06-22

### Changed
- Consolidated active documentation around the current product model, command UX, architecture, safety, preflight, autoload, and audit notes.
- Clarified `/construct load` help text to include direct-resource path arguments.
- Simplified autoload to passive quit-time prompts only; removed the session-time `.pi/settings.json` watcher and mid-session autoload prompts.
- Added a `check:hygiene` script for unused local/parameter checks.
- Split saved-loadout helper logic and shared dashboard/run operation handling into smaller internal modules without changing the public command surface.
- Renamed the saved-loadout command module from stale profile language to `commands/saved-loadouts.ts`; JSON schema compatibility is unchanged.
- Added small shared UI scroll/truncation helpers for Construct summary, confirmation, and progress panels.
- Added normalized local source details to verbose status package declaration lines.
- Added effective runtime command/tool source summaries and duplicate-name notes to verbose status.
- Added a shared package source-set helper for raw/normalized declared, active, and disabled package declarations.
- Clarified saved-loadout runtime copy and docs around activate-only behavior: saved recipes install/enable their package sources and do not disable, remove, or exact-match other project packages.

### Fixed
- Made dashboard and unload TUI selection identities distinct from visible package ids, so remembered sources with the same derived id do not collapse into one checkbox.
- Clarified JSON diagnostics so unreadable files are reported as read/parse failures rather than only “invalid JSON”.

### Removed
- Removed stale completed planning docs now covered by current docs and the changelog.

## 0.0.13 - 2026-06-22

### Added
- Added `/construct save <name>`, `/construct list`, and `/construct run <saved-name>` as the public saved-loadout command language.
- Added `/construct share <saved-name>` to print a shareable saved-loadout JSON snippet.
- Added `/construct remove <saved-name>` to delete only a saved loadout recipe.
- Added saved-loadout rows to the main `/construct` dashboard.
- Added `/construct import [json]` to validate and preview saved-loadout snippets, with TUI confirmation before writing and a TUI paste box when no JSON is provided.
- Added direct project resource inventory to `/construct status full` and `/construct` for trusted project extensions, skills, prompt templates, and themes.
- Added `/construct load` adoption for direct project resources into `.pi/construct.json` metadata without adding project-local files to the portable Construct library.
- Added dashboard enable/disable actions for adopted direct project resources using Pi-native top-level `+path` / `-path` filters.
- Added `docs/profiles-and-sharing-plan.md` to capture saved-loadout and sharing decisions.

### Changed
- Profile save now skips disabled resources and, in TUI, can offer active project resources not loaded into Construct for optional loading/inclusion before saving.
- Saving over an existing loadout now asks before replacing in TUI and refuses replacement in non-TUI.
- User-facing docs now prefer saved loadout/saved wording and keep unreleased profile/saved aliases out of the public command surface.
- `/construct run <saved-name>` now uses the dashboard-style TUI progress/result/reload panel.
- Selecting saved loadouts in `/construct` runs them through the same package operation flow as package rows, while avoiding duplicate package operations for repeated sources.
- Saved loadout dashboard rows now act as recipe/spotlight rows: they show member status counts, mark member package rows with `[·]`, and let Space quick-select member package rows without turning disable/remove into saved-loadout group actions.
- Share/import output warns for local path sources and refuses generated Pi package cache paths or source strings that look like secrets.
- Status/dashboard diagnostics now use Pi's native `DefaultPackageManager.resolve()` / `SettingsManager` resource discovery path for direct project resources instead of custom filesystem rules.
- Dashboard state language now uses resource-neutral `Active` instead of package-centric `Installed`.
- Documented and enforced the current split: saved loadouts/share snippets remain package-source-only while direct project-local resources stay project-local metadata/toggle state.

### Fixed
- Collapsed duplicate project metadata rows for equivalent local package sources, so relative and absolute forms of the same package do not appear as separate dashboard resources.

## 0.0.12 - 2026-06-21

### Added
- Added transparent `/construct autoload` session watching: when autoload is on in a trusted TUI project, Construct watches `.pi/settings.json`, waits for Pi to be idle, and asks before loading newly declared compatible packages into Construct.
- Added `docs/autoload-transparency.md` to document watcher mechanics, expected cost, security posture, caveats, and UX improvements.

### Changed
- Construct JSON writes now use temp-file-and-rename atomic writes to reduce the chance of truncated JSON after interrupted writes.
- Kept autoload explicit and confirmation-only; it still never installs packages, enables resources, reloads Pi, or edits `.pi/settings.json`.
- Quit-time autoload now labels disabled package declarations in its confirmation prompt and preserves their disabled metadata when loading them into Construct.
- Updated the `/construct` dashboard row grammar to separate selection from state: `[x]` marks selected rows, while compact color-coded `✓`, `–`, `+`, and `◇` icons show current state.
- Improved the TUI filter area with an explicit `Filter packages:` label and hint text.
- Removed trailing per-row action hints from the dashboard to keep rows narrow and avoid implying Enter is the only possible action.
- Kept `Unloaded` as the user-facing term for project declarations that are not in Construct; `/construct load` remains the adoption path.
- Dashboard/profile package operations now distinguish metadata-only failures from no-op failures, so runtime-affecting partial changes still get reload guidance.
- Re-read project/library/profile state after idle waits in load, unload, profile, and package install flows to reduce stale-snapshot overwrites.
- Simplified the dashboard TUI title to a quiet `Loadout:` count line with pipe separators.
- Tuned dashboard TUI colors: headings use accent color, active icons use a clearer green, disabled icons use muted green, available icons stay yellow, and unloaded icons stay gray.

## 0.0.11 - 2026-06-21

### Added
- Added `docs/dashboard-action-model-plan.md` for the accepted dashboard state/key model.
- Added a dashboard remove confirmation before project-local package removal.
- Added `/construct load <id-or-source ...>` to directly adopt matching unloaded project package declarations.

### Changed
- Changed dashboard states to `Installed`, `Disabled`, `Available`, and `Unloaded`.
- Changed dashboard Enter to apply the obvious state transition for actionable rows: install Available, disable Installed, or enable Disabled.
- Kept Unloaded rows read-only in `/construct`; `/construct load` remains the adoption path and now shows only unloaded/adoptable package declarations.
- Removed the public `d` dashboard action; `r` remains the explicit remove key for Installed and Disabled rows.

## 0.0.10 - 2026-06-21

### Added
- Added a user-local known-project index and informational known-project assignment counts in status/unload flows.
- Added dashboard recognition for Pi package objects disabled by resource filters.
- Added `docs/pi-config-and-construct.md` and `docs/package-disable-design.md` to capture Pi config overlap and the package disable/remove model.

### Changed
- Changed the dashboard to the state model `Loaded`, `Disabled`, `Installed`, and `Available`.
- Changed dashboard TUI actions to selected rows plus explicit actions: Space selects, Enter loads/enables, `d` disables, and `r` removes project declarations.
- Clarified `/construct unload` output so it says Construct forgot resources while leaving package declarations and active packages alone.
- Construct now waits for the current agent response to finish before file-changing operations and lets dashboard applies cancel before the next package-changing step.
- `/construct status` now distinguishes metadata drift from packages disabled by Pi package filters.

### Removed
- Removed the quiet `/construct run` dashboard alias; `/construct` is the dashboard entrypoint.

## 0.0.9 - 2026-06-19

### Added
- Added quiet `/construct run` alias for the default Construct Loadout dashboard.
- Added `MAP.md` as the versioned roadmap/action list.

### Changed
- Refocused `AGENTS.md` as the compact agent/build guide.
- Refocused `TODO.md` as a scratchpad for research and undecided ideas.
- Clarified near-term roadmap around unload wording, known-project assignment counts, and print-first `/construct copy` snippets.

### Removed
- Removed the old root planning note and `docs/roadmap.md` in favor of `AGENTS.md`, `MAP.md`, and `TODO.md`.

## 0.0.8 - 2026-06-19

### Added
- Added `/construct load` as the explicit command for adding current project resources to the Construct.
- Added `/construct unload` for removing resources from the Construct library without uninstalling project packages.
- Added `/construct autoload` as an off-by-default exit prompt that always confirms before loading project resources.

### Changed
- Replaced current public sync wording with load/unload terminology across README, docs, command output, and smoke coverage.
- `/construct status` now describes manual load state instead of sync state.

### Removed
- Removed `/construct sync` and `/construct reload` from the active command surface.

## 0.0.7 - 2026-06-19

### Added
- Added regression coverage for duplicate Construct sync ids and `requestedSource` local path normalization.
- Added in-panel dashboard apply progress with a spinner, elapsed time, per-package progress, and verbose results.
- Added Enter-to-reload behavior after successful dashboard loadout changes; Esc returns to the session without reloading.

### Changed
- Streamlined `/construct` into a package-first dashboard with `Enabled`, `Available`, and `Project-only` sections.
- Removed runtime skill/command inventory from the default dashboard; runtime diagnostics remain available in `/construct status`.
- Refreshed README install/uninstall examples for npm, git, and local filepath installs.
- Reframed active docs from early-stage language to the current product model.
- Successful dashboard apply now stays in one focused TUI flow instead of using footer status plus a separate summary panel.
- Successful sync and profile action summaries now render in a focused TUI panel instead of a footer-style notification.
- Hid `/construct reload` from public command help and docs; use Pi's normal reload path instead.

### Fixed
- Fixed `/construct sync` project metadata updates so multiple selected package sources with the same derived id do not overwrite each other.
- Reused shared source identity handling during sync so managed local package metadata is recognized consistently.

### Removed
- Pruned completed audit/fix-plan scratch docs and consolidated review prompts into the pre-flight checklist.

## 0.0.6 - 2026-06-19

### Changed
- Renamed the npm package from `the-construct` to `pi-construct`.
- Made `npm run release:verify` publish-safe and lightweight: typecheck plus npm pack dry run only.
- Added `npm run smoke:all` for the full disposable Pi smoke suite.

## 0.0.5 - 2026-06-19

### Changed
- Prepared the package for npm publishing by removing the private flag and adding npm repository metadata.
- Added npm publish verification scripts and README npm install/publish notes.

## 0.0.4 - 2026-06-19

### Added
- Added WIP profile commands for saving, listing, and applying named groups of Construct-managed package sources.
- Added profile storage to the Construct user library catalog and profile counts to `/construct status`.
- Added README example output using realistic Pi package sources from the package catalog.

### Changed
- Changed the explicit adopt-all sync command to `/construct sync auto`; `-a` and `--all` remain compatibility aliases.
- Moved sync behavior explanation into `/construct status`; `/construct sync status` now redirects users there.
- Marked profile commands as WIP in the README while the feature remains pre-public.

## 0.0.3 - 2026-06-19

### Changed
- Collapsed the active command surface back to one primary `/construct` loadout menu plus minimal support commands: `status`, `sync`, and `reload`.
- Updated README, handoff docs, and smoke coverage around the smaller command surface.
- Ignored repo-local `.pi/settings.json` and `.pi/construct.json` so personal Construct state stays untracked.

### Removed
- Removed public `load`, `unload`, `toggle`, `library`, `remember`, `forget`, `catalog`, `enable`, `disable`, `remove`, `on`, `off`, and `wipe` command paths.

## 0.0.2 - 2026-06-18

### Added
- Added live TUI status progress for sequential multi-package load/unload flows so saves no longer appear idle while Pi installs/removes packages.

### Changed
- `/construct sync` now opens an adoption menu instead of auto-adopting candidates in TUI mode.
- Added `/construct sync -a` / `--all` as the explicit adopt-all shortcut for non-interactive and power-user flows.
- Centralized package load/unload operations so multi-select flows apply changes without recursively invoking command handlers.
- Preserved forward-compatible Construct library item metadata such as future `groups` fields.
- Updated Pi development dependencies to 0.79.7.

### Fixed
- Fixed relative local package source handling so sources loaded as `./pkg` remain recognized as on/off after Pi records them relative to `.pi/settings.json`.
- Reused normalized local path removal for unload, disable, and remove compatibility paths.
- Prevented invalid or structurally unsafe Construct library JSON from being overwritten by library writes.

### Removed
- Removed unused/stale helper paths left from earlier iterations.

## 0.0.1 - 2026-06-18

### Added
- Added the full `/construct` loadout dashboard with grouped package sections and searchable read-only runtime skill/command inventory.
- Added fuzzy filtering to checkbox-style TUI pickers: type to search/filter, Space toggles, Enter saves, Esc cancels.
- Added checkbox-style TUI pickers for `/construct`, `/construct load`, `/construct unload`, and multi-item `/construct sync`.
- Added a permanent end-to-end smoke test for Project A raw local Pi install, `/construct sync`, Project B load, reload, single unload, reload, toggle-off, toggle-on, and reload.
- Added `/construct toggle` as the public project loadout switch for Construct-managed packages, with hidden `/construct off` and `/construct on` aliases for testing.
- Added clearer `/construct sync` output showing selected project-local package sources adopted from `.pi/settings.json`.
- Added public library verbs: `/construct library`, `/construct remember`, and `/construct forget`; `/construct catalog` remains a compatibility alias.

### Changed
- Removed active autoload/startup behavior. Construct no longer prompts, opens, syncs, or writes files when a project loads.
- Removed `/construct autoload`, `/construct autosync`, and related user-local settings/skip handling.
- `/construct load` no longer auto-syncs local project packages. Use `/construct sync` as the explicit adoption step for local-only Pi packages.
- `/construct sync` now adopts only unsynced local packages, auto-adopts a single candidate, and opens a searchable save-based picker when multiple candidates are available.
- `/construct sync` now arms adopted local packages in `.pi/construct.json` so they become Construct-managed for the project.
- `/construct load` now proceeds after selection/command without a second confirmation page, leaves reload timing to the user, and prints `/construct reload` / `/reload` instructions.
- `/construct unload` now focuses on loaded Construct-managed project declarations instead of defaulting to unload-all.
- `/construct unload <source-or-id>` still unloads a single managed package declaration.
- `/construct wipe` was removed from the primary flow; use `/construct toggle` instead.
- `/construct catalog` with no subcommand now correctly lists the library instead of treating the dashboard default as a nested subcommand.
- `/construct sync` now focuses on the current project's local package declarations. Global package declarations are intentionally out of scope.
- Refactored the Construct extension into focused modules under `extensions/construct/`.
- Polished successful load, unload, and sync summaries to be shorter, avoid noisy Pi stdout/stderr, and give clearer reload guidance.

### Fixed
- Improved unload behavior for local package sources where Pi records a relative path and Construct stores a normalized path.
- Kept `.pi/settings.json` as Pi's source of truth and `.pi/construct.json` as advisory metadata.

## 0.0.0

### Added
- Initial implementation for `/construct status`, `/construct load`, `/construct unload`, `/construct sync`, `/construct catalog`, and reload helpers.
