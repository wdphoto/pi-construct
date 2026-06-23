<img width="498" height="278" alt="morfeo-the-construct" src="https://github.com/user-attachments/assets/ccd93aca-1b89-416e-a67e-aa151cfe8f7f" />

# The Construct

The Construct is a **global** extension for [Pi](https://pi.dev) that manages project-level loadouts.

Run `/construct`, tap **Space** to select a resource, then hit **Enter** to apply. Life is good.

## Install Construct

Install flavours:

```bash
pi install npm:pi-construct
# or
pi install git:github.com/wdphoto/pi-construct
# or
pi install https://github.com/wdphoto/pi-construct
# or
pi install ~/Code/pi-construct
```

## Loadout menu

Run:

```text
/construct
```

If the project has never been loaded into Construct, the dashboard shows a quiet “no Construct metadata yet” hint. Nothing is written until you run `/construct load` or apply an explicit dashboard action.

Example:

```text
pi-construct@0.0.18
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

Space selects · Enter applies/runs · r removes · Esc cancels
```

In the live TUI, the dashboard title includes the package/version string, followed by a quiet count line. Row content is color-coded by state: saved/loadout and active use the heading accent, disabled is muted, available is yellow, and unloaded/read-only is gray. The cursor and checkbox markers stay plain; the focused row content is bold.

States:

| State | Meaning | Enter | `r` |
| --- | --- | --- | --- |
| `Loadouts` | named package-source loadout recipe | run in this project | no-op |
| `Active` | active in this project and Construct-managed | disable | remove from project, after warning |
| `Disabled` | present here, but Pi package/direct resource filters are off | enable | remove from project for packages; no delete for direct resources |
| `Available` | remembered by Construct, not installed in this project | install into project | no-op |
| `Unloaded` | declared/discovered in this project, not loaded into Construct | read-only | read-only |

Use `/construct load` to adopt unloaded package declarations into Construct. Direct project resources (`.pi/skills/`, `.pi/prompts/`, `.pi/themes/`, `.pi/extensions/`) can be adopted into project-local Construct metadata without adding those project-local files to the portable library or saved/share snippets; after adoption, dashboard Enter toggles them with Pi-native resource filters.

Package disable/enable is a whole-package toggle. Disabling a package writes empty Pi package resource filters; enabling clears those filters. Construct does not snapshot partial package filters yet, so edit Pi settings directly if you need package-internal resource selection.

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

Save the active package sources as a named loadout recipe:

```text
/construct save web-stack
```

If active package declarations have not been loaded into Construct yet, TUI save shows them as optional packages you can select to load/include. Direct project-local resources are intentionally not included in saved loadouts or share snippets; save warns when those are present.

To update that recipe later, make the desired package sources active and save the same name again. Construct replaces the saved recipe; it does not append or merge.

To wipe only the saved recipe:

```text
/construct wipe web-stack
```

In another project, run that saved loadout:

```text
/construct run web-stack
```

To look for trusted projects with unloaded package declarations or direct `.pi/` resources:

```text
/construct scan
```

Run `/construct scan` with no path to scan trusted Pi paths from Pi's trust store. Pass a folder only when you want to inspect a specific local tree, such as a monorepo or project parent. In the TUI, scan shows lightweight progress and a selectable review list; Space selects findings and Enter loads them into Construct. Print-mode scan is read-only. Scan is project-local: it looks for Pi-trusted projects with `.pi/settings.json`, `.pi/construct.json`, `.pi/extensions/`, `.pi/skills/`, `.pi/prompts/`, and `.pi/themes/`. Untrusted projects are skipped and listed. It does not scan global/user skill locations or Pi package caches.

Or run `/construct`, focus a loadout recipe and press Enter to activate it, or select an `Available` package with Space and press Enter to install it. Loadout rows are recipe/spotlight rows: focusing one marks package rows with `[·]`; pressing Space on the loadout row quick-selects those package rows for bulk package actions.

## Commands

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

Direct examples:

```text
/construct load npm:pi-web-access
/construct unload npm:pi-web-access
```

Notes:

- `/construct scan` reports unloaded resources over trusted Pi paths. `/construct scan <path>` scans a specific local tree, useful for monorepos or project parent folders. Both modes scan only Pi-trusted projects and skip noisy directories such as `node_modules`, `.git`, `.pi/npm`, `.pi/git`, `dist`, and `build`. In TUI mode, selected findings can be loaded into Construct; print mode stays read-only and ends with `No files were changed.`
- `/construct load <source>` adopts an existing declaration from `.pi/settings.json`; it does not install new packages. `/construct load` can also adopt direct project-local Pi resources into `.pi/construct.json` metadata only.
- `/construct unload <source>` makes Construct forget a resource; it does not edit `.pi/settings.json` and does not disable or remove packages from projects.
- `/construct save <loadout-name>` includes active Construct-managed package sources. Active package declarations not loaded into Construct are shown as optional load/include rows in TUI. Disabled package declarations are skipped. Direct project-local resources are not included yet and are reported when present. Saving an existing loadout name replaces that saved recipe rather than appending or merging; TUI asks before replacing, while non-TUI refuses overwrite for safety.
- `/construct list` lists saved loadouts.
- `/construct run <saved-name>` applies the saved loadout once in activate-only mode; it installs/enables recipe package sources but does not disable, remove, or exact-match other packages. Projects are not live-linked to saved loadouts.
- `/construct share <saved-name>` prints a small JSON snippet of package sources; local path sources are warned as not generally shareable.
- `/construct wipe <saved-name>` deletes only the saved recipe; it does not edit project files, uninstall packages, or remove package sources from the Construct library.
- `/construct import <json>` previews a snippet and, in TUI, asks before writing it to your user-local Construct library.
- In `/construct`, Enter on a focused loadout activates it additively. Space on a loadout selects its recipe item rows instead, so normal Enter/`r` package-row actions apply to those package rows.
- Use `r` in `/construct` to remove an active or disabled Construct-managed package declaration from the current project.

## How it works

- `.pi/settings.json` is the source of truth.
- `.pi/construct.json` is advisory metadata for Construct's UI.
- `~/.pi/agent/construct/catalog.json` is your user-local Construct library and saved-loadout store.
- `~/.pi/agent/construct/projects.json` is a user-local index of projects Construct has touched; assignment counts and missing-path notes in `/construct status full` are informational only.

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
