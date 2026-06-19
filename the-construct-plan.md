# the-construct Planning Notes

This file is now the index for the Construct plan. The detailed notes were split into smaller docs so decisions do not get lost in one giant scroll.

## Start here

- [Product model](docs/product-model.md) — current workflow, hard boundaries, manual load/unload, no startup behavior.
- [Safety and maintenance](docs/safety-and-maintenance.md) — no auto-install, trust boundaries, backups, known risks.
- [Commands and UX](docs/commands-and-ux.md) — `/construct`, load/unload, autoload, WIP profile, and reload guidance.
- [Architecture and data model](docs/architecture.md) — layers, user/project state, catalog, settings.
- [Idiomatic Pi model](docs/pi-model.md) — Pi primitives Construct should build on instead of replacing.
- [Roadmap and future work](docs/roadmap.md) — phase plan, profiles/export ideas, open questions.
- [Pre-flight checklist](docs/preflight-checklist.md) — manual checks and design review prompts before adding features.
- [Autoload removal plan](docs/autoload-removal-plan.md) — historical pivot away from startup behavior; current autoload is opt-in and confirm-on-exit.

## Current hard rules

- Keep loadout changes manual and explicit.
- Construct must not silently install, enable, copy, load, update, or reload project code.
- `/construct` may install/remove packages only after an explicit dashboard selection.
- `/construct load` is manual; automatic/invisible load is not part of the current product.
- Autoload/startup behavior is not active. Construct must not prompt, load, open, or write files on project/session start.
- Autoload, when enabled, may prompt only on session quit and must always require confirmation before writing.
- A project with no `.pi/construct.json` should still open the full Construct loadout view without creating metadata.
- `.pi/settings.json` remains Pi's source of truth. `.pi/construct.json` is advisory metadata only.
- Pi owns package resolution and dependency installs. Construct only remembers and replays Pi-supported sources.

## Supported explicit package sources

Construct delegates to Pi's native package installer, so explicit loads can use the source forms Pi supports:

- local paths;
- git URLs/shorthands;
- npm package specs.

Equivalent command for turning on a user-selected package:

```bash
pi install <source> -l --approve
```

That command is never run from background/startup/load paths.
