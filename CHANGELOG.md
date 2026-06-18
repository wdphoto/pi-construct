# Changelog

All notable changes to the Construct will be documented here.

This project is currently pre-1.0. Until releases are tagged, entries are grouped under `Unreleased`.

## Unreleased

### Added
- Added the full `/construct` loadout dashboard with grouped package sections and read-only runtime skill/command inventory.
- Added checkbox-style TUI pickers for `/construct`, `/construct load`, and `/construct unload`: Space toggles multiple package items, Enter saves, Esc cancels.
- Added a permanent end-to-end smoke test for Project A raw local Pi install, `/construct sync`, Project B load, reload, single unload, reload, toggle-off, toggle-on, and reload.
- Added `/construct toggle` as the public project loadout switch for Construct-managed packages, with hidden `/construct off` and `/construct on` aliases for testing.
- Added clearer `/construct sync` output showing the project-local package sources remembered from `.pi/settings.json`.

### Changed
- `/construct load` no longer auto-syncs local project packages. Use `/construct sync` as the explicit adoption step for local-only Pi packages.
- `/construct sync` now arms adopted local packages in `.pi/construct.json` so they become Construct-managed for the project.
- `/construct load` now proceeds after selection/command without a second confirmation page, leaves reload timing to the user, and prints `/construct reload` / `/reload` instructions.
- `/construct unload` now focuses on loaded Construct-managed project declarations instead of defaulting to unload-all.
- `/construct unload <source-or-id>` still unloads a single managed package declaration.
- `/construct wipe` was removed from the primary flow; use `/construct toggle` instead.
- `/construct sync` now focuses on the current project's local package declarations. Global package declarations are intentionally out of scope for the MVP.
- Refactored the Construct extension into focused modules under `extensions/construct/`.

### Fixed
- Improved unload behavior for local package sources where Pi records a relative path and Construct stores a normalized path.
- Kept `.pi/settings.json` as Pi's source of truth and `.pi/construct.json` as advisory metadata.

## 0.0.0

### Added
- Initial MVP for `/construct status`, `/construct load`, `/construct unload`, `/construct sync`, `/construct catalog`, and reload helpers.
