# TODO

Scratchpad for research notes, open questions, and ideas that are not yet committed roadmap work. Decided work belongs in `MAP.md`; shipped history belongs in `CHANGELOG.md`.

## Current open questions

- Autoload is postponed and hidden from the public surface. Revisit only if users ask for it and Pi exposes a safe public package-install/settings-change event.
- Should stale paths in `~/.pi/agent/construct/projects.json` be pruned automatically when seen, or only through an explicit cleanup/doctor command?
- Should known-project counts ever appear in dashboard rows, or stay limited to status/unload contexts?

## Ideas not yet committed

- Future portable direct-resource export/import: design only if users need `.pi/extensions`, prompts, skills, or themes to move between projects without first becoming a Pi package. Current saved loadouts/share snippets stay package-source-only.
- First-run/never-loaded messaging for projects with no `.pi/construct.json`, triggered only by explicit `/construct`.
- Optional onboarding/startup automation behind explicit opt-in only.
- A lightweight doctor report for duplicate package/resource provenance, overlapping runtime tool names, and stale known-project entries.
- Deferred package filter snapshots: if whole-package toggles prove too blunt, consider snapshotting prior package filters into `.pi/construct.json` before disable and restoring them on enable. Do not combine this with package-internal browsing unless Construct deliberately becomes a resource browser.
- Research optional package internals/"pluck resources" flow for fat packages: show package-contained skills/extensions/prompts/themes in a drill-down or sub-section, then allow project-local Pi package filters to enable only selected internals. Start with installed packages only; avoid turning Construct into a package browser/package manager; decide later whether saved loadouts should preserve package source + filter recipes.
- If Pi exposes a stable package-install or settings-change event later, consider it before reintroducing any autoload behavior.
