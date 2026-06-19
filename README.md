# The Construct

The Construct is a Pi extension for grabbing the tools you need.

It is deliberately not a package manager. Pi still owns package install/removal, trust, caches, reloads, and resource loading. Construct only helps you remember package sources and turn them on or off.

## How it works

- `.pi/settings.json` is the source of truth.
- `.pi/construct.json` is advisory metadata for Construct's UI.
- `~/.pi/agent/construct/catalog.json` is your user-local Construct library.
- Nothing happens automatically on startup.
- No auto-sync, auto-load, auto-disable, or auto-reload.

## Commands

```text
/construct             # open the loadout menu
/construct status      # read-only diagnostics
/construct sync        # choose current project packages to remember
/construct sync auto   # remember all new current project packages
/construct sync off    # explain that automatic sync is off
/construct profile list
/construct profile save <name>
/construct profile apply <name>
/construct reload      # reload Pi resources
```

## Example `/construct` output

```text
Construct loadout
=================
Project: /Users/you/project

ON — Construct packages
-----------------------
[x] pi-web-access  https://github.com/nicobailon/pi-web-access

OFF — Construct packages
------------------------
[ ] pi-subagents  https://github.com/nicobailon/pi-subagents

AVAILABLE — Construct library
-----------------------------
[ ] agent-skills  https://github.com/addyosmani/agent-skills

LOCAL-ONLY — not in Construct
-----------------------------
[!] local-tooling  /Users/you/dev/local-tooling

SKILL COMMANDS — runtime, read-only
-----------------------------------
[i] /review  github.com/mattpocock/skills

COMMANDS — runtime, read-only
-----------------------------
[i] /construct  the-construct/extensions/construct/index.ts

Space toggles Construct packages in TUI. Local-only and runtime items are read-only.
Run /construct sync to adopt local-only packages.
```

## Basic workflow

Install a Pi package in a project the normal Pi way:

```bash
pi install <source> -l --approve
```

Ask Construct to remember that project package declaration:

```text
/construct sync
```

Use `/construct sync auto` only when you explicitly want to adopt every new package declaration in the current project.

Optionally save the current Construct-managed loadout as a named profile:

```text
/construct profile save www
```

Later, in another project, run:

```text
/construct
```

The menu shows remembered packages and lets you turn them on or off for the current project. To turn on a saved group with fewer clicks:

```text
/construct profile apply www
```

After changing the loadout, reload Pi when you are ready:

```text
/construct reload
```

## Safety rules

- Construct toggles whole Pi package declarations in the MVP.
- `/construct sync` only remembers existing package declarations.
- `/construct sync` does not install, remove, reload, execute package code, or edit `.pi/settings.json`.
- Turning a package off removes the project package declaration only.
- Turning a package off does not delete local source files, npm caches, git clones, or library entries.
- Read-only commands should not create `.pi/construct.json`.

## Development

Load this extension from the repo without installing it globally:

```bash
pi --no-extensions -e .
```

Run checks:

```bash
npm run check
npm run smoke
npm run e2e-smoke
npm run install-smoke
npm run invalid-drift-smoke
```

Test package install/discovery with a disposable home:

```bash
TMP="$(mktemp -d)"
mkdir -p "$TMP/home" "$TMP/project"
HOME="$TMP/home" pi install "$PWD" --approve
(cd "$TMP/project" && HOME="$TMP/home" pi -p '/construct status')
```

Do not use live global Pi config for tests unless you explicitly mean to.

## Repository-local `.pi/`

This repo does not need to commit local `.pi/` state right now. Treat `.pi/settings.json` and `.pi/construct.json` here as personal/dev-machine loadout unless that changes deliberately.

## License

MIT
