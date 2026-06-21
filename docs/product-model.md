# Product model

Construct is a Pi-native loadout menu, not a package manager.

## Goal

Keep Pi global config lean while making project-level Pi capabilities easy to see, install, disable, enable, and remove from one project-local menu.

The source of truth remains normal Pi project config, especially `.pi/settings.json`.

## Current workflow

1. In project A, install a Pi package normally:
   ```bash
   pi install <source> -l --approve
   ```
2. Run `/construct load` in project A.
3. Construct remembers selected package source strings in `~/.pi/agent/construct/catalog.json`.
4. Optionally save the current Construct-managed package group:
   ```text
   /construct profile save www
   ```
5. In project B, run `/construct` or apply the profile:
   ```text
   /construct profile apply www
   ```
6. After dashboard changes, press Enter on the final panel to reload Pi, or Esc to return and run `/reload` later.

## Mental model

- `/construct` is the project loadout menu.
- `/construct load` adds existing project package declarations to the Construct.
- `/construct unload` makes Construct forget resources without changing project package declarations.
- `/reload` is Pi's public reload command; dashboard Enter uses `ctx.reload()` internally.

## Hard rules

- Keep loadout changes manual and explicit.
- Construct must not silently install, enable, disable, remove, copy, load, update, reload, or write project files.
- Autoload is off by default and always confirms before writing.
- `/construct load` is manual adoption only.
- `/construct unload` never edits `.pi/settings.json` or uninstalls project packages.
- `.pi/settings.json` is Pi's source of truth.
- `.pi/construct.json` is advisory metadata only.
- Pi owns package resolution, dependency installs, updates, caches, and trust.
- Construct remembers package source strings, not arbitrary install scripts.
- Construct does not write secrets, tokens, API keys, or auth material.

## Active command surface

```text
/construct
/construct status
/construct load
/construct unload
/construct autoload
/construct profile list          # WIP, not public yet
/construct profile save <name>   # WIP, not public yet
/construct profile apply <name>  # WIP, not public yet
```

Separate toggle/library/catalog command families are intentionally out of the active product surface.

## Data

User library and profiles:

```text
~/.pi/agent/construct/catalog.json
```

Known-project index:

```text
~/.pi/agent/construct/projects.json
```

User Construct settings:

```text
~/.pi/agent/construct/settings.json
```

Project metadata:

```text
.pi/construct.json
```

Project source of truth:

```text
.pi/settings.json
```
