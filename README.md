<img width="498" height="278" alt="morfeo-the-construct" src="https://github.com/user-attachments/assets/ccd93aca-1b89-416e-a67e-aa151cfe8f7f" />

# The Construct

The Construct is a global [Pi](https://pi.dev) extension for managing project-level resources.

Use the `/construct` command, select packages with the `spacebar`, then press `Enter` to apply the obvious state change. Press `r` to remove installed project package declarations after a warning. Unloaded rows are read-only there; use `/construct load` to adopt them into Construct.

```text
Construct Loadout
=================
Project: /Users/you/project
2 installed · 1 disabled · 3 available · 1 unloaded

Installed
---------
[x] pi-web-access  npm:pi-web-access
[x] pi-subagents   git:github.com/your-org/pi-subagents

Disabled
--------
[-] pi-tripwire     git:github.com/your-org/pi-tripwire

Available
---------
[ ] pi-lens         git:github.com/your-org/pi-lens
[ ] pi-chrome       npm:pi-chrome
[ ] pi-ask-user     git:github.com/your-org/pi-ask-user

Unloaded
--------
[u] local-tooling   /Users/you/dev/local-tooling

Space selects · Enter applies · r removes · Esc cancels.

Run `/construct load` to add project-level resources to the Construct.

```

## Basic workflow

Install a Pi package locally in your project:

```bash
pi install <source> -l --approve
```

Load that package declaration into the Construct:

```text
/construct load
# or load one matching project declaration directly
/construct load npm:package-name
```

In another project, run `/construct`. The menu shows remembered packages and lets you install, enable, disable, or explicitly remove installed project package declarations. Unloaded project declarations stay read-only in this menu; run `/construct load` to add them to Construct.

After runtime-affecting loadout changes, press Enter on the final Construct panel to reload Pi. If you return to the session instead, run `/reload` when you are ready.

## How it works

- `.pi/settings.json` is the source of truth.
- `.pi/construct.json` is advisory metadata for Construct's UI.
- `~/.pi/agent/construct/catalog.json` is your user-local Construct library.
- `~/.pi/agent/construct/projects.json` is a user-local index of projects Construct has touched; assignment counts are informational only.

## Commands

```text
/construct             # open the loadout menu
/construct status      # read-only diagnostics
/construct load [id-or-source ...]    # add current project package declarations to the Construct
/construct unload [id-or-source ...]  # remove resources from the Construct
/construct autoload    # toggle exit prompt for loading new resources
/construct profile list          # WIP, not public yet
/construct profile save <name>   # WIP, not public yet
/construct profile apply <name>  # WIP, not public yet
```

Direct load/unload examples:

```text
/construct load npm:pi-web-access
/construct unload npm:pi-web-access
```

`/construct load <source>` adopts an existing project package declaration; install new packages with `pi install <source> -l --approve` or from the `/construct` Available section.

## Install

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

## Uninstall

Remove the Construct extension using the same source form you installed with:

```bash
pi remove npm:pi-construct
pi remove git:github.com/wdphoto/pi-construct
pi remove /path/to/pi-construct
```

`pi uninstall <source>` is also supported as an alias for `pi remove <source>`.

## License

MIT
