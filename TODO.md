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
- Optional package details view for package-contained resources. Keep this out of the main loadout view unless deliberately promoted; Pi config/resource-center already owns broad resource browsing.
- If Pi exposes a stable package-install or settings-change event later, consider it before reintroducing filesystem watching.
