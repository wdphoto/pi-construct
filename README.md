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

Load the project into Construct:

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

- Shows active, disabled, available, and unloaded project resources.
- Remembers package sources so you can reuse them across projects.
- Saves named loadouts as package-source recipes.
- Lets you enable, disable, install, or remove project package declarations from one TUI.
- Can unfold package-contained resources and write Pi-native package filters.
- Can adopt direct project-local `.pi/` resources into project metadata.
- Uses Pi-native settings, package filters, trust checks, and reload behavior.

Construct is a loadout manager, not a new package manager. `.pi/settings.json` stays the source of truth.

## Common commands

```text
/construct                    # open the loadout menu
/construct status [full]      # read-only diagnostics
/construct scan [path]        # find unloaded trusted local project resources
/construct load [...]         # adopt project resources into Construct
/construct unload [...]       # make Construct forget resources
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

## License

MIT
