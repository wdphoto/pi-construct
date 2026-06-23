# TODO

Scratchpad for research notes, open questions, and ideas that are not yet committed roadmap work. Decided work belongs in `MAP.md`; shipped history belongs in `CHANGELOG.md`.

## Current open questions

- Autoload has been simplified to exit-time-only prompts. Keep an eye on whether users miss mid-session prompts before considering any future public Pi event hook.
- Should saved loadouts ever include portable direct resources, or should package sources remain the only shareable unit?
- Should Construct preserve and restore partial Pi package filters when disabling/enabling a package, or is whole-package toggle the right boundary?
- Should stale paths in `~/.pi/agent/construct/projects.json` be pruned automatically when seen, or only through an explicit cleanup/doctor command?
- Should known-project counts ever appear in dashboard rows, or stay limited to status/unload contexts?

## Ideas not yet committed

- First-run/never-loaded messaging for projects with no `.pi/construct.json`, triggered only by explicit `/construct`.
- Optional onboarding/startup automation behind explicit opt-in only.
- A lightweight doctor report for duplicate package/resource provenance, overlapping runtime tool names, and stale known-project entries.
- Research optional package internals/"pluck resources" flow for fat packages: show package-contained skills/extensions/prompts/themes in a drill-down or sub-section, then allow project-local Pi package filters to enable only selected internals. Start with installed packages only; avoid turning Construct into a package browser/package manager; decide later whether saved loadouts should preserve package source + filter recipes.
- If Pi exposes a stable package-install or settings-change event later, consider it before reintroducing filesystem watching.
