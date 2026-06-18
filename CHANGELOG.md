# Changelog

All notable changes to the Construct will be documented here.

This project is currently pre-1.0. Until releases are tagged, entries are grouped under `Unreleased`.

## Unreleased

### Added
- Added a permanent end-to-end smoke test for Project A raw local Pi install, `/construct sync`, Project B load, reload, single unload, reload, unload-all, and reload.
- Added picker actions for already-loaded items so a checked item can be unloaded from the current project.
- Added an unload-all action to the picker flow.
- Added clearer `/construct sync` output showing the project-local package sources remembered from `.pi/settings.json`.

### Changed
- `/construct load` now leaves reload timing to the user and prints `/construct reload` / `/reload` instructions instead of prompting to reload immediately.
- `/construct unload` now unloads all current project package declarations by default.
- `/construct unload <source-or-id>` still unloads a single package declaration.
- `/construct sync` now focuses on the current project's local package declarations. Global package declarations are intentionally out of scope for the MVP.
- Refactored the Construct extension into focused modules under `extensions/construct/`.

### Fixed
- Improved unload behavior for local package sources where Pi records a relative path and Construct stores a normalized path.
- Kept `.pi/settings.json` as Pi's source of truth and `.pi/construct.json` as advisory metadata.

## 0.0.0

### Added
- Initial MVP for `/construct status`, `/construct load`, `/construct unload`, `/construct sync`, `/construct catalog`, and reload helpers.
