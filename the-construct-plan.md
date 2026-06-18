# the-construct Planning Notes

This file is now the index for the Construct plan. The detailed notes were split into smaller docs so decisions do not get lost in one giant scroll.

## Start here

- [MVP contract](docs/mvp.md) — current workflow, hard MVP boundaries, manual sync, autoload once-per-project.
- [Safety and maintenance](docs/safety-and-maintenance.md) — no auto-install, trust boundaries, backups, known risks.
- [Commands and UX](docs/commands-and-ux.md) — `/construct`, load/unload/toggle/sync flows.
- [Architecture and data model](docs/architecture.md) — layers, user/project state, catalog, settings.
- [Idiomatic Pi model](docs/pi-model.md) — Pi primitives Construct should build on instead of replacing.
- [Roadmap and future work](docs/roadmap.md) — phase plan, profiles/export ideas, open questions.
- [Morning audit](docs/morning-audit.md) — next review questions before more implementation.

## Current hard rules

- Keep things manual for MVP.
- Construct must not silently install, enable, copy, sync, update, or reload project code.
- `/construct load` may install only after an explicit user command or selection.
- `/construct sync` is manual; automatic/invisible sync is disabled for MVP.
- Autoload is offer-only: ask `Load it into the Construct? y/n` after trust, then open `/construct` only if accepted.
- The autoload offer should be once per trusted project using user-local seen state, not every reload.
- `.pi/settings.json` remains Pi's source of truth. `.pi/construct.json` is advisory metadata only.
- Pi owns package resolution and dependency installs. Construct only remembers and replays Pi-supported sources.

## Supported explicit package sources

Construct delegates to Pi's native package installer, so explicit loads can use the source forms Pi supports:

- local paths;
- git URLs/shorthands;
- npm package specs.

Equivalent command for a user-selected load:

```bash
pi install <source> -l --approve
```

That command is never run from background/autoload/sync paths.
