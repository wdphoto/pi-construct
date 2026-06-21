<img width="498" height="278" alt="morfeo-the-construct" src="https://github.com/user-attachments/assets/ccd93aca-1b89-416e-a67e-aa151cfe8f7f" />

# The Construct

The Construct is a small global [Pi](https://pi.dev) extension for managing project-local package loadouts.

It does **not** replace `pi install`, `pi remove`, or `pi config`. Normal Pi project files remain the source of truth. Construct remembers package sources you choose to load into its library, then gives you a fast `/construct` menu for installing, enabling, disabling, and removing those project package declarations.

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
2 installed · 1 disabled · 3 available · 1 unloaded

Installed
---------
[x] pi-web-access   npm:pi-web-access
[x] pi-subagents    git:github.com/your-org/pi-subagents

Disabled
--------
[-] pi-browser      npm:pi-browser

Available
---------
[ ] pi-lens         git:github.com/your-org/pi-lens
[ ] pi-chrome       npm:pi-chrome
[ ] pi-ask-user     git:github.com/your-org/pi-ask-user

Unloaded
--------
[u] local-tooling   ../local-tooling

TUI controls: Space selects · Enter applies · r removes · Esc cancels.
```

States:

| State | Meaning | Enter | `r` |
| --- | --- | --- | --- |
| `Installed` | active in this project and Construct-managed | disable | remove from project, after warning |
| `Disabled` | installed here, but Pi package resource filters are off | enable | remove from project, after warning |
| `Available` | remembered by Construct, not installed in this project | install into project | no-op |
| `Unloaded` | declared in this project, not loaded into Construct | read-only | read-only |

Use `/construct load` to adopt `Unloaded` rows into Construct.

After runtime-affecting loadout changes, press Enter on the final Construct panel to reload Pi. If you return to the session instead, run `/reload` when ready.

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

In another project, run `/construct`, select an `Available` package with Space, then press Enter to install it into that project.

## Commands

```text
/construct                         # open the loadout menu
/construct status                  # read-only diagnostics
/construct load [id-or-source ...] # adopt project package declarations into Construct
/construct unload [id-or-source ...] # forget resources from Construct
```

Direct examples:

```text
/construct load npm:pi-web-access
/construct unload npm:pi-web-access
```

Notes:

- `/construct load <source>` adopts an existing declaration from `.pi/settings.json`; it does not install new packages.
- `/construct unload <source>` makes Construct forget a resource; it does not edit `.pi/settings.json` and does not disable or remove packages from projects.
- Use `r` in `/construct` to remove an installed Construct-managed package declaration from the current project.

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
