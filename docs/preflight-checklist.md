# Construct pre-flight checklist

Use disposable `HOME` and fixture projects. Do not edit live global Pi files.

## Current target

Protect the manual product model:

- `/construct` is the primary surface.
- Support commands are `status`, `scan`, `load`, `unload`, `save`, `list`, `run`, `share`, `wipe`, and `import`.
- No startup/shutdown prompt, write, or adoption behavior.
- No separate toggle/library/catalog command family.
- Read-only checks must not create `.pi/construct.json`.
- Mutating project loadout checks must back up `.pi/settings.json` before direct edits.

## Public command surface

```text
/construct
/construct status
/construct scan [path]
/construct load [id-or-source-or-path ...]
/construct unload [id-or-source ...]
/construct save <loadout-name>
/construct list
/construct run <saved-name>
/construct share <saved-name>
/construct wipe <saved-name>
/construct import [json]
```

## New-project behavior

Expected:

- `/construct` prints/opens the loadout view.
- `/construct status` reports missing Construct metadata.
- `.pi/construct.json` is not created.

## Scan

Expected:

- `/construct scan` reads Pi's trust store and reports unloaded package declarations and direct project `.pi/` resources for trusted local paths.
- `/construct scan <path>` reports the same findings under an explicit local folder.
- `/construct scan [path]` lists and skips untrusted projects and overly broad/private trusted roots.
- `/construct scan [path]` skips noisy directories such as `node_modules`, `.git`, `.pi/npm`, `.pi/git`, `dist`, and `build`.
- `/construct scan [path]` does not install packages, unload, change trust, reload Pi, or edit `.pi/settings.json`.
- In TUI mode, selected scan findings can be loaded into Construct, writing only the user Construct library for packages and selected projects' `.pi/construct.json` metadata.
- Print-mode output ends with `No files were changed.`

## Manual load

Expected:

- `/construct load` asks in TUI mode and shows unloaded/adoptable project package declarations and direct project resources.
- `/construct load <id-or-source-or-path ...>` directly loads matching unloaded/adoptable resources.
- `/construct load` explicitly loads current project resources in print mode.
- Load writes the user library for packages and `.pi/construct.json` for adopted resources only because the user explicitly ran load.
- Load does not install, remove, reload, copy, execute, or alter `.pi/settings.json`.

## Manual unload

Expected:

- `/construct unload` asks in TUI mode.
- `/construct unload <id-or-source ...>` removes matching resources from the Construct library.
- Unload prunes matching saved-loadout entries and current-project Construct metadata.
- Unload does not remove package declarations from `.pi/settings.json`.
- Unload does not uninstall project packages.

## Saved loadouts

Expected:

- `/construct save <loadout-name>` saves active Construct-managed package sources from the current project; TUI shows active unloaded package declarations as optional load/include rows.
- Disabled package declarations are skipped.
- In TUI, active package declarations not loaded into Construct can be selected for loading/inclusion; unselected rows are skipped.
- Saving over an existing name asks before replacing in TUI and refuses replacement in non-TUI.
- `/construct list` lists saved loadouts.
- `/construct run <saved-name>` turns those package sources on in the current project and uses the TUI progress/result/reload panel.
- Saved loadouts appear as compact `◆` rows in `/construct`; focusing one marks member package rows with `[·]`, pressing Enter runs it additively, and pressing Space quick-selects its selectable member package rows.
- `/construct share <saved-name>` prints a package-source JSON snippet and warns for local paths.
- `/construct wipe <saved-name>` deletes only the saved recipe and does not edit project files, uninstall/disable packages, or remove package sources from the Construct library.
- `/construct import` opens a TUI paste box; `/construct import <json>` validates snippets, previews in non-TUI without writing, and confirms before writing in TUI.
- Saved loadouts are stored in `~/.pi/agent/construct/catalog.json` as internal profiles.
- Saved loadouts store ids/package sources, not package code, scripts, direct project-local resource files, or portable direct-resource recipes.

Manual TUI import write check:

1. Use a disposable `HOME` and project.
2. Run `/construct import '{"kind":"construct-loadout","version":1,"name":"shared","sources":["npm:example"]}'`.
3. Verify the preview appears before any write.
4. Press Enter to import.
5. Verify `~/.pi/agent/construct/catalog.json` contains the imported saved loadout and source.
6. Verify the current project's `.pi/settings.json` was not created or edited.

## Direct project resource inventory

Expected:

- `/construct status full` reports trusted project-local `.pi/extensions/`, `.pi/skills/`, `.pi/prompts/`, and `.pi/themes/` resources.
- `/construct` shows those direct resources as rows: Unloaded/read-only before adoption, Active/Disabled and selectable after metadata adoption.
- `/construct load` adopts direct project resources into `.pi/construct.json` metadata only and does not add project-local files to the user library, saved loadouts, or share snippets.
- Enter on adopted direct resources writes Pi-native top-level `+path` / `-path` filters in `.pi/settings.json` and updates `.pi/construct.json` enabled state.
- Direct resources are reported with kind, enabled/disabled state, Pi origin/source, Construct state (`unloaded` before adoption), and path.
- Inventory uses Pi trust state; untrusted project-local resources are not forced into the resolved inventory.
- Read-only status does not create `.pi/construct.json` or edit `.pi/settings.json`.

## Dashboard safety

Check in real TUI usage:

- fuzzy search works;
- Space selects package/direct rows, and on a Loadouts row quick-selects its selectable recipe item rows;
- focusing Loadouts rows marks recipe item rows with `[·]` without directly selecting them;
- Enter on a focused Loadouts row runs it additively; Enter on selected package/direct rows installs Available, disables Active, and enables Disabled rows;
- running Loadouts rows is additive/activating only and does not disable/remove active recipe items;
- Unloaded rows are read-only in `/construct`, and `/construct load` shows only unloaded/adoptable rows;
- `r` shows a warning, then removes selected Active or Disabled package declarations; Loadouts rows themselves do not remove recipe items;
- Esc cancels;
- package rows stay primary;
- live TUI title includes the package/version string and a quiet count line;
- focused row content is bold, section headings use accent/heading color, cursor/checkbox markers stay plain, and row content carries state color: saved/loadout and active heading accent, disabled muted, available yellow, unloaded/read-only gray;
- Unloaded rows are clear and do not flood the view;
- runtime inventory stays out of the dashboard and remains visible in status;
- summaries are readable and actionable;
- after runtime-affecting changes, Enter reloads Pi and Esc cancels reload/returns to the session.

## Design review prompts

Before adding new behavior, ask:

- Is this better as part of the one `/construct` menu instead of a new slash command?
- Does every mutating path require explicit user action?
- Are we relying on Pi package/settings primitives instead of rebuilding package management?
- Is `.pi/settings.json` still the source of truth and `.pi/construct.json` only advisory?
- Do saved loadouts still store only library ids/sources, exclude direct project-local resources, and run explicitly?
- Is Enter still the fastest safe path for common install/disable/enable actions?
- Is `/construct load` still the only adoption path for Unloaded rows?

## Local development

Load this extension from the repo without installing it globally:

```bash
pi --no-extensions -e .
```

Test package install/discovery with a disposable home:

```bash
TMP="$(mktemp -d)"
mkdir -p "$TMP/home" "$TMP/project"
HOME="$TMP/home" pi install "$PWD" --approve
(cd "$TMP/project" && HOME="$TMP/home" pi -p '/construct status')
```

Do not use live global Pi config for tests unless you explicitly mean to.

Repository-local `.pi/settings.json` and `.pi/construct.json` are personal/dev-machine loadout unless that changes deliberately.

## Full validation

```bash
npm run check
npm run smoke:all
npm run release:verify
```

Expected: all pass and no generated package caches/temp files are added to git.
