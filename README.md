# The Construct

The Construct is a loadout manager for [Pi](https://pi.dev). Sync the local extensions and skills to the Construct and install them in any future Project. 

Construct does **NOT** replace Pi packages or manage package internals. I'm just trying to get things from A to B that arent global and can be grouped in a construct.profile type thing (down the road).

## Basic flow

In one project, install a Pi package normally:

```bash
pi install <source> -l
```

Then adopt that project package into your Construct library:

```text
/construct sync
```

In another project, open the loadout picker:

```text
/construct
```

Check the packages you want, save, then reload Pi resources when ready:

```text
/construct reload
```

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
/construct sync                         # adopt current project packages into Construct
/construct library                      # list remembered package sources
/construct remember <source> [id]       # add source to library
/construct forget <id-or-source>        # remove source from library
/construct reload                       # reload Pi resources
```

Interactive pickers support fuzzy typing, Space to toggle, Enter to save, and Esc to cancel.

## Important rules

- `.pi/settings.json` is Pi's source of truth.
- `.pi/construct.json` is advisory Construct metadata.
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
