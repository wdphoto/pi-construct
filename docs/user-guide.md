# The Construct User Guide

This is the longer guide for The Construct. The README stays short; details live here.

## Dashboard

Run:

```text
/construct
```

If the project has never been loaded into Construct, the dashboard shows a quiet “no Construct metadata yet” hint. Nothing is written until you run `/construct load` or apply an explicit dashboard action.

If Pi has not trusted the current project, Construct stays read-only: it can inspect declared resources, but it treats them as not runtime-active and refuses load/save/run/dashboard mutations until the project is trusted.

Example:

```text
pi-construct@0.0.24
===================
Project: /Users/you/site
2 active · 1 disabled · 3 available · 1 unloaded

Loadouts
--------
[ ] ◆       www-stack       3 package sources
[ ] ◆       go-stuff        2 package sources
[ ] ◆       pi-projects     5 package sources
[ ] ◆       robotics        3 package sources

Active
------
[ ] ✓  pi-web-access   npm:pi-web-access
[ ] ✓  pi-subagents    git:github.com/your-org/pi-subagents

Disabled
--------
[ ] –  pi-browser      npm:pi-browser

Available
---------
[ ] +  pi-lens         git:github.com/your-org/pi-lens
[ ] +  pi-chrome       npm:pi-chrome
[ ] +  pi-ask-user     git:github.com/your-org/pi-ask-user

Unloaded
--------
[!] ◇  local-tooling   ../local-tooling

✓ active · – disabled · + available · ◇ unloaded

Space selects · Enter applies/runs · → unfolds known package resources · ← folds · i details · r removes · Esc cancels
```

## Dashboard states

| State | Meaning | Enter | `r` |
| --- | --- | --- | --- |
| `Loadouts` | named package-source loadout recipe | run in this project | no-op |
| `Active` | active in this project and Construct-managed | disable | remove from project, after warning |
| `Disabled` | present here, but Pi package/direct resource filters are off | enable | remove from project for packages; no delete for direct resources |
| `Available` | remembered by Construct, not installed in this project | install into project | no-op |
| `Unloaded` | declared/discovered in this project, not loaded into Construct | read-only | read-only |

After runtime-affecting changes, Construct offers to reload Pi. Press Enter to reload, or Esc to keep working and run `/reload` later.

## Basic workflow

Install a Pi package locally in a project:

```bash
pi install npm:package-name -l --approve
```

Load that package declaration into Construct:

```text
/construct load npm:package-name
```

Or open the load picker for all unloaded project declarations:

```text
/construct load
```

Save the active package sources as a named loadout recipe:

```text
/construct save web-stack
```

To update that recipe later, make the desired package sources active and save the same name again. Construct replaces the saved recipe; it does not append or merge.

To run the saved loadout in another project:

```text
/construct run web-stack
```

Running a saved loadout is additive: it installs missing recipe packages, enables disabled matches, and skips already-active matches. It does not remove other project packages.

## Direct project resources

Construct can adopt direct project-local resources from:

```text
.pi/extensions/
.pi/skills/
.pi/prompts/
.pi/themes/
```

Direct resources are project-local. They can be toggled in the dashboard after adoption, but they are not included in saved loadouts or share snippets yet.

## Package-contained resources

On package rows with multiple Pi-resolved resources, press Right Arrow to unfold package-contained extensions, skills, prompts, and themes.

- Child state icons show current state: `✓` active, `–` inactive, `+` available.
- `[x]` on a child means selected for the next action; unselected children are left alone.
- `[~]` on a package means mixed child resource state with nothing selected.
- Space on a package row cycles child selection presets: `[x]` all, `[-]` active, `[+]` inactive/available, then none.
- `[*]` on a package means a custom subset of children is selected inside the fold.
- Enter previews and writes native Pi package filters in `.pi/settings.json` after a backup.

Selected existing child resources are toggled; unselected existing child resources keep their current state. Available child selections install only those selected resources. Use whole-package Enter when you want Pi's default package behavior.

Available package rows only unfold when Construct already has a cached multi-resource list. Unknown or single-resource packages stay as normal whole-package rows.

## Scanning for unloaded resources

Run:

```text
/construct scan
```

With no path, scan reads Pi's trust store and scans trusted local paths. You can also pass a folder, such as a monorepo or project parent:

```text
/construct scan ../projects
```

Scan looks for trusted Pi projects with `.pi/settings.json`, `.pi/construct.json`, `.pi/extensions/`, `.pi/skills/`, `.pi/prompts/`, or `.pi/themes/`. Untrusted projects are skipped and listed. Print-mode scan is read-only and ends with `No files were changed.` In the TUI, selected findings can be loaded into Construct.

Scan does not inspect global/user skill locations or generated Pi package caches.

## Command reference

```text
/construct                           # open the loadout menu
/construct status [full]             # read-only diagnostics
/construct scan [path]               # find unloaded trusted local project resources
/construct load [id-or-source-or-path ...] # adopt project resources into Construct
/construct unload [id-or-source ...]       # forget resources from Construct
/construct save <loadout-name>       # save active package sources as a named loadout
/construct list                      # list saved loadouts
/construct run <saved-name>          # run a saved loadout in this project
/construct share <saved-name>        # print a shareable saved-loadout JSON snippet
/construct wipe <saved-name>         # wipe a saved loadout recipe only
/construct import [json]             # paste/preview/import a saved-loadout JSON snippet
```

Notes:

- `/construct load <source>` adopts an existing declaration from `.pi/settings.json`; it does not install new packages.
- `/construct unload <source>` makes Construct forget a resource; it does not edit `.pi/settings.json` and does not disable or remove packages from projects.
- `/construct save <name>` includes active Construct-managed package sources. Disabled package declarations are skipped. Direct project-local resources are not included yet.
- `/construct share <name>` prints a small JSON snippet of package sources; local path sources are warned as not generally shareable.
- `/construct wipe <name>` deletes only the saved recipe; it does not edit project files, uninstall packages, or remove package sources from the Construct library.

## Source of truth

- `.pi/settings.json` is the source of truth.
- `.pi/construct.json` is advisory metadata for Construct's UI.
- `~/.pi/agent/construct/catalog.json` is your user-local Construct library and saved-loadout store.
- `~/.pi/agent/construct/projects.json` is a user-local index of projects Construct has touched; assignment counts and missing-path notes in `/construct status full` are informational only.
