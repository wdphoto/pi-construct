# MVP contract

Construct is a Pi-native loadout menu, not a package manager.

## Goal

Keep Pi global config lean while making project-level Pi capabilities easy to see and toggle from one place.

The source of truth remains normal Pi project config:

- `.pi/settings.json`
- `.pi/extensions/`
- `.pi/skills/`
- `.pi/prompts/`
- `.pi/themes/`
- project package declarations

Construct stores only user-local install memory and advisory project metadata.

## Current workflow

1. In project A, install a Pi package normally:
   ```bash
   pi install <source> -l --approve
   ```
2. Run `/construct sync` or `/construct sync -a` in project A.
3. Construct remembers selected package source strings in `~/.pi/agent/construct/catalog.json`.
4. In project B, run `/construct`.
5. Use the one menu to turn remembered sources on/off for that project.
6. Run `/construct reload` or Pi's `/reload` when ready.

## Hard rules

- Keep things manual for MVP.
- Construct must not silently install, enable, copy, sync, update, reload, or write project files.
- No startup/autoload behavior.
- `/construct sync` is manual adoption only.
- `.pi/settings.json` is Pi's source of truth.
- `.pi/construct.json` is advisory metadata only.
- Pi owns package resolution, dependency installs, updates, caches, and trust.
- Construct remembers package source strings, not arbitrary install scripts.
- Construct does not write secrets, tokens, API keys, or auth material.

## Active command surface

```text
/construct
/construct status
/construct sync
/construct sync -a
/construct sync status
/construct reload
```

Separate load/unload/toggle/library/catalog command families are intentionally out of the active MVP.

## Data

User library:

```text
~/.pi/agent/construct/catalog.json
```

Project metadata:

```text
.pi/construct.json
```

Project source of truth:

```text
.pi/settings.json
```

## Out of MVP

- Startup/onboarding automation.
- Resource-level package filters.
- Profiles/export/import.
- Project-type detection.
- Package update/pinning UX.
- Managing `AGENTS.md`, `CLAUDE.md`, `.pi/SYSTEM.md`, or `.pi/APPEND_SYSTEM.md`.
