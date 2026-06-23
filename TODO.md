# TODO

Scratchpad for research notes, open questions, and ideas that are not yet committed roadmap work. Decided work belongs in `MAP.md`; shipped history belongs in `CHANGELOG.md`.

## Current open questions

- Autoload is postponed and hidden from the public surface. Revisit only if users ask for it and Pi exposes a safe public package-install/settings-change event.

## Ideas not yet committed

- Future portable direct-resource export/import: design only if users need `.pi/extensions`, prompts, skills, or themes to move between projects without first becoming a Pi package. Current saved loadouts/share snippets stay package-source-only.
- Optional onboarding/startup automation behind explicit opt-in only.
- A lightweight doctor report for duplicate package/resource provenance, overlapping runtime tool names, and optional stale known-project pruning. Current decision: `/construct status full` reports missing known-project paths but does not prune automatically.
- Future known-project dashboard counts only if the index becomes authoritative enough to explain them clearly. Current decision: keep counts out of dashboard rows and limit them to status/unload contexts.
- Deferred package filter snapshots: Construct currently refuses whole-package toggles for already-partial Pi package filters. If users need richer transitions later, consider snapshotting prior package filters into `.pi/construct.json` before disable and restoring them on enable. Do not combine this with package-internal browsing unless Construct deliberately becomes a resource browser.
- Package internals/"pluck resources" flow is now tentatively planned as a small package-row picker; see `docs/package-resource-picker-plan.md`. Initial research note: `docs/package-resource-plucking-research.md`.
- If Pi exposes a stable package-install or settings-change event later, consider it before reintroducing any autoload behavior.
