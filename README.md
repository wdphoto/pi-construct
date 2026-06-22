<img width="498" height="278" alt="morfeo-the-construct" src="https://github.com/user-attachments/assets/ccd93aca-1b89-416e-a67e-aa151cfe8f7f" />

# The Construct

The Construct is a small global [Pi](https://pi.dev) extension for managing project-level loadouts.

It does **not** replace `pi install`, `pi remove`, or `pi config`. Normal Pi project files remain the source of truth. Construct remembers package sources you choose to load into its library, then gives you a fast `/construct` menu for installing, enabling, disabling, and removing those project package declarations. It also reports direct project-local Pi resources such as `.pi/skills/`, `.pi/prompts/`, `.pi/themes/`, and `.pi/extensions/`; `/construct load` can adopt them into advisory metadata so dashboard Enter can toggle them with Pi-native resource filters.

## Loadout menu

Run:

```text
/construct
```

Example:

```text
Construct Loadout
=================
Project: /Users/you/site
2 active · 1 disabled · 3 available · 1 unloaded

Saved
-----
[ ] ◆  web-stack       3 package sources

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
    ◇  local-tooling   ../local-tooling

Legend: [ ] selectable · [x] selected · [·] saved member · ◆ saved · ✓ active · – disabled · + available · ◇ unloaded.
Controls: Space selects · on Saved, selects members · Enter applies/runs · r removes active/disabled · Esc cancels.
```

In the live TUI, the dashboard title is a quiet `Loadout:` count line. State meaning is carried by the icon column: active is green, disabled is muted green, available is yellow, and unloaded is gray. Plain output stays uncolored for readability.

States:

| State | Meaning | Enter | `r` |
| --- | --- | --- | --- |
| `Saved` | named package-source loadout | run in this project | no-op |
| `Active` | active in this project and Construct-managed | disable | remove from project, after warning |
| `Disabled` | present here, but Pi package/direct resource filters are off | enable | remove from project for packages; no delete for direct resources |
| `Available` | remembered by Construct, not installed in this project | install into project | no-op |
| `Unloaded` | declared/discovered in this project, not loaded into Construct | read-only | read-only |

Use `/construct load` to adopt unloaded package declarations into Construct. Direct project resources (`.pi/skills/`, `.pi/prompts/`, `.pi/themes/`, `.pi/extensions/`) can be adopted into project-local Construct metadata without adding those project-local files to the portable library or saved/share snippets; after adoption, dashboard Enter toggles them with Pi-native resource filters.

After runtime-affecting loadout changes, press Enter on the final Construct panel to reload Pi. Esc cancels reload and returns to the session; run `/reload` later when ready.

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

Save the active Construct package sources as a named loadout:

```text
/construct save web-stack
```

In another project, run that saved loadout:

```text
/construct run web-stack
```

Or run `/construct`, focus a saved loadout and press Enter to run it, or select an `Available` package with Space and press Enter to install it. Saved loadout rows are recipe/spotlight rows: focusing one marks member package rows with `[·]`; pressing Space on the saved row quick-selects those member package rows for bulk package actions.

## Commands

```text
/construct                           # open the loadout menu
/construct status                    # read-only diagnostics
/construct load [id-or-source ...]   # adopt project package declarations into Construct
/construct unload [id-or-source ...] # forget resources from Construct
/construct save <name>               # save active Construct package sources as a named loadout
/construct list                      # list saved loadouts
/construct run <saved-name>          # run a saved loadout in this project
/construct share <saved-name>        # print a shareable saved-loadout JSON snippet
/construct remove <saved-name>       # remove a saved loadout recipe only
/construct import [json]             # paste/preview/import a saved-loadout JSON snippet
```

Direct examples:

```text
/construct load npm:pi-web-access
/construct unload npm:pi-web-access
```

Notes:

- `/construct load <source>` adopts an existing declaration from `.pi/settings.json`; it does not install new packages. `/construct load` can also adopt direct project-local Pi resources into `.pi/construct.json` metadata only.
- `/construct unload <source>` makes Construct forget a resource; it does not edit `.pi/settings.json` and does not disable or remove packages from projects.
- `/construct save <name>` includes active Construct package sources. Disabled package declarations are skipped. In TUI, active package declarations not loaded into Construct can be selected for inclusion.
- `/construct list` lists saved loadouts.
- `/construct run <saved-name>` applies the saved loadout once; projects are not live-linked to saved loadouts.
- `/construct share <saved-name>` prints a small JSON snippet of package sources; local path sources are warned as not generally shareable.
- `/construct remove <saved-name>` deletes only the saved recipe; it does not edit project files, uninstall packages, or remove package sources from the Construct library.
- `/construct import <json>` previews a snippet and, in TUI, asks before writing it to your user-local Construct library.
- In `/construct`, Enter on a focused saved loadout runs it additively. Space on a saved loadout selects its member package rows instead, so normal Enter/`r` package-row actions apply to those members.
- Use `r` in `/construct` to remove an active or disabled Construct-managed package declaration from the current project.

## How it works

- `.pi/settings.json` is the source of truth.
- `.pi/construct.json` is advisory metadata for Construct's UI.
- `~/.pi/agent/construct/catalog.json` is your user-local Construct library.
- `~/.pi/agent/construct/projects.json` is a user-local index of projects Construct has touched; assignment counts are informational only.

## Install Construct

Install from npm:

```bash
pi install npm:pi-construct
```

Install from git:

```bash
pi install git:github.com/wdphoto/pi-construct
# or
pi install https://github.com/wdphoto/pi-construct
```

## Remove Construct

Remove the Construct extension using the same source form you installed with:

```bash
pi remove npm:pi-construct
pi remove git:github.com/wdphoto/pi-construct
pi remove /path/to/pi-construct
```

`pi uninstall <source>` is also supported as an alias for `pi remove <source>`.

## License

MIT
