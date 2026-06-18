# Changelog

All notable changes to the Construct will be documented here.

This project is currently pre-1.0. Until releases are tagged, entries are grouped under `Unreleased`.

## Unreleased

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
- `/construct sync` now focuses on the current project's local package declarations. Global package declarations are intentionally out of scope for the MVP.
- Refactored the Construct extension into focused modules under `extensions/construct/`.

### Fixed
- Improved unload behavior for local package sources where Pi records a relative path and Construct stores a normalized path.
- Kept `.pi/settings.json` as Pi's source of truth and `.pi/construct.json` as advisory metadata.

## 0.0.0

### Added
- Initial MVP for `/construct status`, `/construct load`, `/construct unload`, `/construct sync`, `/construct catalog`, and reload helpers.
