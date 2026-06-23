# TODO

Scratchpad for research notes, open questions, and ideas that are not yet committed roadmap work. Decided work belongs in `MAP.md`; shipped history belongs in `CHANGELOG.md`.

## Current open questions

- Autoload is postponed and hidden from the public surface. Revisit only if users ask for it and Pi exposes a safe public package-install/settings-change event.

## Fresh review notes — 2026-06-23

- Done: untrusted projects are read-only/inspectable. Dashboard/status label raw declarations as not runtime-active, and load/save/run/dashboard mutations refuse until Pi trusts the project.
- Done: package filter/direct-resource/package-removal `.pi/settings.json` edits now persist through Pi `SettingsManager` project setters after Construct's backup.
- Done: dashboard/run package install/remove now use Pi's exported `DefaultPackageManager.installAndPersist()` / `removeAndPersist()` instead of shelling out to `pi install/remove` from inside Pi.
- `/construct run <saved-name>` currently schedules every source as `Install`, unlike the dashboard saved-row path which skips active packages and enables disabled ones. That is slower, can do unnecessary network/package-manager work, and may ask for reload when nothing meaningful changed. Reuse project inventory to build only needed activate-only steps.
- Available package child-resource picking is based on cache-only temporary resolution, then installs the package and writes filters from that cached list. For unpinned npm/git sources, the installed package may differ from the cached package. Re-resolve after install or warn/disable child picking for stale/unpinned cache results.
- The package resource filter write planner lives inside `commands/dashboard.ts`. Extract the pure selection-to-filter planning into a small module and unit-test edge cases, especially same relative path across resource kinds and all-empty selections.
- `/construct unload <source>` matches exact catalog id/source/name only. Make it use the same package source identity matching as load/dashboard so local path spelling and git URL equivalents work consistently.

## Ideas not yet committed

- Future portable direct-resource export/import: design only if users need `.pi/extensions`, prompts, skills, or themes to move between projects without first becoming a Pi package. Current saved loadouts/share snippets stay package-source-only.
- Optional onboarding/startup automation behind explicit opt-in only.
- A lightweight doctor report for duplicate package/resource provenance, overlapping runtime tool names, and optional stale known-project pruning. Current decision: `/construct status full` reports missing known-project paths but does not prune automatically.
- Future known-project dashboard counts only if the index becomes authoritative enough to explain them clearly. Current decision: keep counts out of dashboard rows and limit them to status/unload contexts.
- Deferred package filter snapshots: Construct currently refuses whole-package toggles for already-partial Pi package filters. If users need richer transitions later, consider snapshotting prior package filters into `.pi/construct.json` before disable and restoring them on enable. Do not combine this with package-internal browsing unless Construct deliberately becomes a resource browser.
- Package internals/"pluck resources" flow now has a first dashboard picker implementation; remaining open questions are in `docs/package-resource-picker-plan.md`. Initial research note: `docs/package-resource-plucking-research.md`.
- If Pi exposes a stable package-install or settings-change event later, consider it before reintroducing any autoload behavior.
