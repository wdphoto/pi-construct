# Changelog

All notable changes to the Construct will be documented here.

This project is currently pre-1.0. Released changes are tagged from `0.0.1` onward.

## Unreleased

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
