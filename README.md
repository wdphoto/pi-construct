<img width="498" height="278" alt="morfeo-the-construct" src="https://github.com/user-attachments/assets/ccd93aca-1b89-416e-a67e-aa151cfe8f7f" />

# The Construct

The Construct is a global [Pi](https://pi.dev) extension for managing project-level resources.

Use the `/construct` command, select your loadout with the `spacebar`, and hit `Enter` to apply.

```text
Construct Loadout
=================
Project: /Users/you/project
2 enabled · 3 available · 1 project-only

Enabled
-------
[x] pi-web-access  npm:pi-web-access
[x] pi-subagents   git:github.com/your-org/pi-subagents

Available
---------
[ ] pi-lens         git:github.com/your-org/pi-lens
[ ] pi-chrome       npm:pi-chrome
[ ] pi-ask-user     git:github.com/your-org/pi-ask-user

Project-only
------------
[!] local-tooling   /Users/you/dev/local-tooling

Space toggles. Enter applies. Esc cancels.

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
```

In another project, run `/construct`. The menu shows remembered packages and lets you toggle them on or off for that project.

After applying loadout changes, press Enter on the final Construct panel to reload Pi. If you return to the session instead, run `/reload` when you are ready.

## How it works

- `.pi/settings.json` is the source of truth.
- `.pi/construct.json` is advisory metadata for Construct's UI.
- `~/.pi/agent/construct/catalog.json` is your user-local Construct library.

## Commands

```text
/construct             # open the loadout menu
/construct status      # read-only diagnostics
/construct load        # add current project resources to the Construct
/construct unload      # remove resources from the Construct
/construct autoload    # toggle exit prompt for loading new resources
/construct profile list          # WIP, not public yet
/construct profile save <name>   # WIP, not public yet
/construct profile apply <name>  # WIP, not public yet
```

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
