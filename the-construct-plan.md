# the-construct Planning Notes

This file is now the index for the Construct plan. The detailed notes were split into smaller docs so decisions do not get lost in one giant scroll.

## Start here

- [Product model](docs/product-model.md) — current workflow, hard boundaries, manual sync, no startup behavior.
- [Safety and maintenance](docs/safety-and-maintenance.md) — no auto-install, trust boundaries, backups, known risks.
- [Commands and UX](docs/commands-and-ux.md) — `/construct`, sync, profile, and reload flows.
- [Architecture and data model](docs/architecture.md) — layers, user/project state, catalog, settings.
- [Idiomatic Pi model](docs/pi-model.md) — Pi primitives Construct should build on instead of replacing.
- [Roadmap and future work](docs/roadmap.md) — phase plan, profiles/export ideas, open questions.
- [Pre-flight checklist](docs/preflight-checklist.md) — manual checks and design review prompts before adding features.
- [Autoload removal plan](docs/autoload-removal-plan.md) — current pivot away from startup behavior; keep `/construct sync` as the explicit adoption command.

## Current hard rules

- Keep loadout changes manual and explicit.
- Construct must not silently install, enable, copy, sync, update, or reload project code.
- `/construct` may install/remove packages only after an explicit dashboard selection.
- `/construct sync` is manual; automatic/invisible sync is not part of the current product.
- Autoload/startup behavior is removed. Construct must not prompt, sync, open, or write files on project/session load.
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

That command is never run from background/startup/sync paths.
