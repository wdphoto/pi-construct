# Product model

Construct is a Pi-native loadout menu, not a package manager.

## Goal

Keep Pi global config lean while making project-level Pi capabilities easy to see and toggle from one place.

The source of truth remains normal Pi project config, especially `.pi/settings.json`.

## Current workflow

1. In project A, install a Pi package normally:
   ```bash
   pi install <source> -l --approve
   ```
2. Run `/construct sync` or `/construct sync auto` in project A.
3. Construct remembers selected package source strings in `~/.pi/agent/construct/catalog.json`.
4. Optionally save the current Construct-managed package group:
   ```text
   /construct profile save www
   ```
5. In project B, run `/construct` or apply the profile:
   ```text
   /construct profile apply www
   ```
6. Run `/construct reload` or Pi's `/reload` when ready.

## Hard rules

- Keep loadout changes manual and explicit.
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
/construct sync auto
/construct sync off
/construct profile list
/construct profile save <name>
/construct profile apply <name>
/construct reload
```

Separate load/unload/toggle/library/catalog command families are intentionally out of the active product surface.

## Data

User library and profiles:

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
