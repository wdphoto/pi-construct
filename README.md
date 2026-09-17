<img width="498" height="278" alt="morfeo-the-construct" src="https://github.com/user-attachments/assets/ccd93aca-1b89-416e-a67e-aa151cfe8f7f" />

# The Construct

The Construct is a **global** extension for [Pi](https://pi.dev) that manages project-level resource packages like extensions, skills, prompts, themes, and loadouts from one menu.

This README is the main human guide for Construct.

Run `/construct`, hit **Spacebar** to select what belongs in the project, press **Enter** to apply. Easy stuff.

## Install

```bash
pi install npm:pi-construct
# or
pi install git:github.com/wdphoto/pi-construct
# or
pi install https://github.com/wdphoto/pi-construct
# or
pi install ~/Code/pi-construct
```

## Quick start

Install a Pi package in a project:

```bash
pi install npm:package-name -l --approve
```

Adopt the already-installed project package/resource declarations into Construct metadata:

```text
/construct load
```

Open the loadout menu:

```text
/construct
```

Save the active package set for later:

```text
/construct save web-stack
```

Run that saved loadout in another project:

```text
/construct run web-stack
```

## What it does

- Shows active, disabled, unresolved, available, and unloaded project resources.
- Remembers package sources so you can reuse them across projects.
- Saves named loadouts as package-source recipes.
- Lets the dashboard enable, disable, install, or remove project package declarations from one TUI.
- Can unfold package-contained resources and write Pi-native package filters.
- Can adopt Pi-resolved project resources from `.pi/`, project `.agents/skills`, and project settings paths into project metadata.
- Uses Pi-native settings, package filters, trust checks, and reload behavior.

For exact extension/skill/prompt/theme inheritance and overrides, use Pi's native project resource editor:

```bash
pi config -l
```

Construct uses Pi-resolved package resources to identify known active and all-off states. A Construct-managed declared package with no resolved resources is shown as **Unresolved** unless it is explicitly whole-package-disabled; that declaration stays **Disabled** and enableable. An unadopted declaration remains read-only **Unloaded**, with its unresolved or all-off detail shown rather than treated as active. Remembered sources no longer declared remain installable.

Saving excludes all-off partial-filter and unresolved declarations with an explicit summary. Running a saved loadout skips and explains those rows; inspect the declaration with `pi config -l`. Partly active filtered packages remain active, and Construct preserves partial Pi filters rather than clearing them as a workaround.

Child-resource filter actions cannot be mixed with package, direct-resource, or saved-loadout selections: split them into separate actions. Parent aggregate selection within one child group and multiple child-only package groups remain valid. Before filtering, Construct rechecks the reviewed declaration and Pi-resolved resource list and enabled state; additions, removals, or state changes require re-review without changing unrelated settings. Installing an Available package and then filtering it is non-atomic: installation can remain if refreshed declaration policy, resources, or trust stop filtering. If installation succeeds but filters do not, package defaults may remain enabled; re-review before reloading.

Construct always treats Pi `autoload: false` project override entries as read-only and excludes them from Construct package operations; use `pi config -l` for their inherit/load/unload state. Saved Construct loadouts remain package-source recipes: they do not copy direct skill files or serialize package child-resource filters.

Construct is a loadout manager, not a new package manager. `.pi/settings.json` stays the source of truth.

Unload forgets matching package ownership without deleting resources or changing Pi settings. In the dashboard, Space-select eligible package rows (or all children of one package), press `Ctrl+U`, and confirm to forget them from the Construct library, saved-loadout references, and current-project metadata. `Ctrl+R` still removes a package from the project with its existing focused-row fallback, while `Alt+I` opens details and `/construct wipe <name>` deletes only a saved recipe. Plain `u`, `r`, and `i` (upper or lower case) always remain filter text. Partial child groups, direct resources, saved rows, Unloaded rows, and override rows refuse the whole unload batch. Declarations can remain visible as Unloaded after reopening.

Scan refuses the filesystem root, home directory, and home-level `.pi`, `.agents`, `.claude`, and `.codex` directories as scan roots, including symlink aliases. Before every scan/reconcile metadata or catalog write, Construct rechecks target trust through Pi; denied, missing, or unreadable trust skips the target without granting trust. Earlier writes can remain and are reported, while independent trusted targets can continue. Share's credential-warning output omits rejected source values; always review source URLs before sharing.

## Common commands

```text
/construct                    # open the loadout menu
/construct status [full]      # read-only diagnostics
/construct scan [path]        # find unloaded trusted Pi-resolved project resources
/construct load [...]         # adopt already-installed project resources into Construct metadata
/construct unload [...]       # forget package ownership, not uninstall
/construct save <name>        # save active package sources as a loadout
/construct list               # list saved loadouts
/construct run <name>         # apply a saved loadout to this project
/construct share <name>       # print a shareable loadout JSON snippet
/construct import [json]      # preview/import a shared loadout snippet
/construct wipe <name>        # delete only a saved loadout recipe
```

## Files

- `.pi/settings.json` — Pi project source of truth.
- `.pi/construct.json` — project-local Construct metadata.
- `~/.pi/agent/construct/catalog.json` — user-local Construct library and saved loadouts.
- `~/.pi/agent/construct/projects.json` — user-local index of touched projects.

## Remove Construct

Use the same source form you installed with:

```bash
pi remove npm:pi-construct
pi remove git:github.com/wdphoto/pi-construct
pi remove /path/to/pi-construct
```

`pi uninstall <source>` is also supported as an alias for `pi remove <source>`.

## Development checks

With dependencies installed and `pi`, Bash, and Python 3 on your PATH:

```bash
npm run check
npm run check:hygiene
npm run smoke:all
npm run release:verify
```

Smoke scripts use disposable homes, clear inherited Pi config/session directory overrides, and run Pi offline. They do not use your live global Pi configuration.

## License

MIT
