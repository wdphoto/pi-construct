# Product model

Construct is a Pi-native loadout menu, not a package manager.

## Goal

Keep Pi global config lean while making project-level Pi capabilities easy to see, apply, disable, enable, and remove from one project-local menu.

The source of truth remains normal Pi project config and resources: `.pi/settings.json`, `.pi/extensions/`, `.pi/skills/`, `.pi/prompts/`, `.pi/themes/`, and related native Pi project files.

## Direction: native project resources

Construct is a project-level Pi resource manager. Package loadouts are the current implementation, but the product model includes every native Pi project resource kind Pi can already load from project settings or trusted project-local discovery:

- packages
- extensions
- skills
- prompt templates
- themes

System prompt files are also native Pi project resources, but should be handled as a later explicit file-resource slice.

Current direct-resource support includes inventory in `/construct status full`, rows in `/construct`, `/construct load` adoption into project-local Construct metadata, and dashboard toggles for adopted direct resources using Pi-native `+path` / `-path` filters. Decision: direct resources remain project-local for now and are not saved/shared unless a future portable path/export/package model is deliberately designed.

## Current package workflow

1. In project A, install a Pi package normally:
   ```bash
   pi install <source> -l --approve
   ```
2. Run `/construct load` in project A.
3. Construct remembers selected package source strings in `~/.pi/agent/construct/catalog.json`.
4. Optionally save the current active Construct package-source group:
   ```text
   /construct save www
   ```
5. In project B, run `/construct` or run the saved loadout:
   ```text
   /construct run www
   ```
6. After dashboard changes, press Enter on the final panel to reload Pi, or Esc to cancel reload and run `/reload` later.

## Mental model

- `/construct` is the project loadout menu.
- `/construct load` adds existing project package declarations to the Construct and adopts direct project resources into project metadata.
- `/construct unload` makes Construct forget resources without changing project package declarations.
- `/construct save` names the current active Construct package-source grouping.
- `/construct run` applies a saved loadout once in activate-only mode: it installs/enables recipe package sources and does not disable, remove, or exact-match anything outside the recipe. Saved loadouts are not live project bindings.
- `/reload` is Pi's public reload command; dashboard Enter uses `ctx.reload()` internally.

## Hard rules

- Keep loadout changes manual and explicit.
- Construct must not silently install, enable, disable, remove, copy, load, update, reload, or write project files.
- `/construct load` is manual adoption only.
- `/construct unload` never edits `.pi/settings.json` or uninstalls project packages.
- `.pi/settings.json` and project-local `.pi/` resources are Pi's source of truth.
- `.pi/construct.json` is advisory metadata only.
- Pi owns package resolution, dependency installs, updates, caches, resource discovery, and trust.
- Construct remembers package source strings and project-local direct-resource metadata; it does not invent arbitrary install scripts.
- Saved loadouts and shared snippets are package-source data for now, not executable scripts.
- Project-local direct resources are not saved/shared or portable to other projects in the current product model; they require a future explicit copy/export/package flow before becoming portable.
- Package enable/disable is whole-package only for unfiltered or whole-package-disabled declarations for now. Construct does not snapshot partial Pi package filters and refuses to replace already-partial filters with whole-package toggles.
- Package-contained resource picking writes native Pi package filters. For Available packages, this is an explicit install-with-filters dashboard action when Construct can cache-inspect multiple package resources without network/download: unfold with Right Arrow, install project-local after confirmation, then disable unselected package-contained resources with Pi filters. Child-resource selection is an explicit allowlist, so package resources added later remain disabled until selected; whole-package row actions keep Pi's default package behavior.
- Construct does not write secrets, tokens, API keys, or auth material.

## Active command surface

```text
/construct
/construct status
/construct scan [path]
/construct load
/construct unload
/construct save <loadout-name>
/construct list
/construct run <saved-name>
/construct share <saved-name>
/construct wipe <saved-name>
/construct import [json]
```

Separate toggle/library/catalog command families are intentionally out of the active product surface.

## Data

User library and saved loadouts:

```text
~/.pi/agent/construct/catalog.json
```

Known-project index:

```text
~/.pi/agent/construct/projects.json
```

Known-project entries are informational. `/construct status full` may report entries whose stored paths are missing, but Construct does not prune this file automatically. Known-project counts stay out of dashboard rows for now because the index is package-only and not authoritative filesystem usage.

Project metadata:

```text
.pi/construct.json
```

Project source of truth:

```text
.pi/settings.json
```
