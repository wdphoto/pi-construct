# The Construct

The Construct is a rapid loadout manager for [Pi](https://pi.dev).

Sync your local project tools to the Construct and install them on any other project. It stores a replayable Pi package source, like:

```text
npm:@scope/pi-tools
https://github.com/user/pi-package
/Users/me/code/local-pi-package
```

This does **NOT** replace Pi packages or manage package internals. It's basically a glorified autofill for local package management.

I'm just trying to get things from point A to B, C and D that arent global and can be grouped in a construct.profile type thing (down the road). Maybe a directory level implimentation?

## Basics

While in a project, install your local Pi packages normally:

```bash
pi install -l <source>
```

Then adopt that project package into your Construct library with `/construct sync` and follow the menu. Use `/construct sync -a` to adopt all new project packages without the menu.

## Construct Load

In another project use `/construct` or `/construct load`.

Check the packages you want, save, then `/reload`.

## Example `/construct` output

```text
Construct loadout
=================
Project: /Users/me/code/my-project

ON — Construct packages
-----------------------
[x] agent-skills      https://github.com/addyosmani/agent-skills
[x] pi-web-access     https://github.com/nicobailon/pi-web-access

OFF — Construct packages
------------------------
[ ] ollama-pi-web-search  npm:@ollama/pi-web-search

AVAILABLE — Construct library
-----------------------------
[ ] pi-subagents      https://github.com/nicobailon/pi-subagents

LOCAL-ONLY — not in Construct
-----------------------------
[!] local-tools       /Users/me/code/local-tools

SKILL COMMANDS — runtime, read-only
-----------------------------------
[i] /skill:code-review-and-quality  https://github.com/addyosmani/agent-skills

COMMANDS — runtime, read-only
-----------------------------
[i] /construct  the-construct
```

Meaning:

- `[x]` package source is declared in this project.
- `[ ]` package source is remembered and available to load.
- `[!]` local-only project package is not adopted into Construct yet.
- `[i]` runtime command/skill inventory is read-only.

## Commands

```text
/construct                              # loadout picker
/construct status                       # read-only project status
/construct load [source-or-library-id]  # load package into this project
/construct unload [source-or-library-id] # disable package in this project
/construct toggle                       # flip Construct-managed loadout off/on
/construct sync                         # choose project packages to adopt into Construct
/construct sync -a                      # adopt all new project packages into Construct
/construct library                      # list remembered package sources
/construct remember <source> [id]       # add source to library
/construct forget <id-or-source>        # remove source from library
/construct reload                       # reload Pi resources
```

Interactive pickers support fuzzy typing, Space to toggle, Enter to save, and Esc to cancel. I'm going for fast and snappy here. Feedback welcome.

Note: slash-command source parsing is intentionally simple. If a local package path contains spaces, use the interactive/manual source input instead of typing it directly in `/construct remember <source>`.

## Important rules

- `.pi/settings.json` is Pi's source of truth.
- `.pi/construct.json` is advisory Construct metadata.
- Construct toggles whole Pi package declarations in the MVP; package resource filters stay Pi-owned.
- `/construct sync` never installs or removes packages.
- `/construct unload` disables the project declaration only. It does not delete local files, npm caches, git clones, or library entries.
- Construct does not auto-sync, auto-load, auto-disable, or auto-reload on startup.
- Run `/construct reload` or Pi's `/reload` after load/unload/toggle when you want resources refreshed.

## Development

Load from this repo without installing globally:

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

Test install/discovery with a disposable home:

```bash
TMP="$(mktemp -d)"
mkdir -p "$TMP/home" "$TMP/project"
HOME="$TMP/home" pi install "$PWD" --approve
(cd "$TMP/project" && HOME="$TMP/home" pi -p '/construct status')
```

## License

MIT
