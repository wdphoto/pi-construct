# Saved loadouts and sharing plan

This note promotes profiles from a WIP command family to the next product slice. In user-facing copy, prefer **saved loadout** or just **saved**. `profile` remains the internal catalog/data-model word.

Status: command language, save semantics, run UX parity, saved rows in `/construct`, print-first share, saved-loadout remove, and import preview/confirmation are implemented.

## Decisions

- Public save command: `/construct save <name>`.
- Public list command: `/construct list`.
- Public run command: `/construct run <saved-name>`.
- Public share command: `/construct share <saved-name>`.
- Public remove command: `/construct remove <saved-name>`.
- Unreleased `/construct saved`, `/construct copy`, and `/construct profile ...` aliases are not part of the public surface.
- A saved loadout is a named grouping of **active Construct package sources** for now.
- Disabled package declarations are skipped.
- Active package declarations that are not loaded into Construct are offered during save; selected packages are loaded into Construct and included, unselected packages are skipped.
- Adopted direct project-local resources are not saved or shared yet. They stay project-local metadata/toggle state until Construct has an explicit portable direct-resource path/export model.
- Save is replace-only. It never appends or merges with an existing saved loadout.
- If a saved loadout name already exists, TUI asks before replacing it.
- Replacing a saved loadout changes only the saved recipe. Projects that already ran it are not live-linked and do not change.
- Shared loadouts should be JSON snippets, not executable scripts.

## Product model

A saved loadout answers:

> “What active Construct package sources make up this workflow?”

It is intentionally not a full `.pi/settings.json` snapshot. The unit is still a Pi package source remembered by Construct. Direct project-local skills/prompts/themes/extensions can be adopted and toggled in their source project, but they are not part of saved loadouts or share snippets yet. Pi remains responsible for package installation, package resolution, project trust, resource execution, updates, and reloads.

## Native Pi fit

Pi already has the primitives saved loadouts need:

- project-local package declarations in `.pi/settings.json`;
- package source strings accepted by `pi install <source> -l --approve`;
- package resource filters for disabled resources;
- project trust before project-local resources execute;
- `/reload` / `ctx.reload()` after runtime-affecting changes.

Construct should compose those primitives. Running a saved loadout should use the same package-loading path as dashboard Available rows. It should never bypass project trust, write global Pi settings, execute a script, or copy package caches.

## Save behavior

When the user runs:

```text
/construct save web-stack
```

Construct reads the current project state and classifies package declarations only:

1. **Active and already loaded into Construct** — included automatically.
2. **Active but not loaded into Construct** — offered in a TUI picker. Selected rows are loaded into Construct and included. Unselected rows are skipped.
3. **Disabled by Pi package filters** — skipped without prompting.

Low-tech TUI prompt:

```text
Save loadout: web-stack

These active package declarations are not loaded into Construct yet.
Select any to load into Construct and include in this saved loadout.

[ ] pi-review-tools   npm:pi-review-tools
[ ] browser-kit       git:github.com/org/browser-kit

Space selects · Enter continues · Esc cancels
```

Save summary should be explicit:

```text
Saved loadout: web-stack
Included package sources: 3
Loaded into Construct and included package sources: 1
Skipped active package declarations not loaded into Construct: 1
Skipped disabled package declarations: 2
```

If the name already exists, TUI asks before replacing:

```text
Replace saved loadout: web-stack

Existing package sources: 3
New package sources:      4

Added:
+ npm:pi-tests

Removed:
- npm:pi-debug

Unchanged:
  npm:pi-browser
  npm:pi-review

Enter replaces · Esc cancels
```

No append mode. No merge mode. No automatic `web-stack-2` versioning.

In non-TUI mode, replacement should refuse for now because there is no confirmation UI. Non-TUI save may still create a new saved loadout and should report skipped active package declarations that were not already loaded into Construct.

## Run behavior

When the user runs:

```text
/construct run web-stack
```

Construct applies that saved loadout to the current project. “Run” is Construct language for applying a saved loadout; it does **not** execute an arbitrary script.

TUI/result language should stay clear:

```text
Running loadout: web-stack

✓ Install pi-browser
✓ Install review-tools

Enter reloads Pi · Esc skips reload
```

Running a saved loadout is not a live binding. If the saved loadout is later replaced, projects that already ran it do not change.

## Sharing model

Sharing should print/import saved loadouts as small JSON snippets:

```json
{
  "kind": "construct-loadout",
  "version": 1,
  "name": "web-stack",
  "sources": [
    "npm:@org/pi-browser-tools",
    "git:github.com/org/pi-review-tools"
  ]
}
```

Rules:

- Include active package sources only.
- No secrets, auth material, env values, generated package cache paths, or installed cache locations.
- Local path package sources may be saved for personal reuse but should be warned as not generally shareable across machines.
- Direct project-local resource paths/file contents are excluded for now; review portable direct paths or an explicit export/copy format later.
- `/construct share <name>` prints JSON to screen/output. It is not clipboard and not file export in this slice.
- `/construct import` opens a TUI paste box for JSON, then previews and confirms before writing.
- `/construct import <json>` remains a direct paste/print fallback; non-TUI previews only and changes no files.
- Import writes only the user-local Construct library/saved loadout first. Running it in a project remains a separate explicit action.
- `/construct remove <name>` deletes only the saved recipe. It does not edit project files, uninstall/disable packages, remove package sources from the Construct library, or reload Pi.

## Dashboard/UI direction

Saved loadouts should become first-class in `/construct`, but not drown out the package loadout.

Recommended TUI shape:

```text
Loadout: 2 active | 1 disabled | 3 available | 0 unloaded

Saved
-----
[ ] ◆  web-stack       2 active · 1 available
[ ] ◆  pi-projects     3 active

Active
------
[ ] ✓  pi-browser      npm:pi-browser
```

- Keep the quiet package-count title.
- Put saved loadouts above package sections when present.
- Saved-loadout row grammar: `[ ] ◆  web-stack  2 active · 1 available`.
- Saved rows are recipe/spotlight rows. Focusing one marks member package rows with `[·]` without selecting those rows.
- Enter on a focused saved row runs it through the same in-panel progress/result flow as package rows, installing/enabling only package sources that are not already active.
- Space on a saved row quick-selects its selectable member package rows, so normal package-row Enter/`r` actions can be used on the recipe members.
- Disable/remove remains a package-row action, not a saved-loadout group action.

## Implementation slices

### Slice 1 — command language and save semantics — implemented

- Add `/construct save <name>`, `/construct list`, and `/construct run <name>` as canonical commands.
- Keep unreleased profile/saved aliases out of the public surface.
- Update save behavior to include active Construct-managed package sources and offer active unloaded package declarations for inclusion in TUI.
- Skip disabled package declarations.
- Confirm before replacing an existing saved loadout in TUI.
- Refuse replacement in non-TUI mode for now.
- Update smoke coverage for save/run.

### Slice 2 — run UX parity — implemented

- Bring `/construct run <name>` into the newer in-panel progress/result/reload flow used by the dashboard.
- Keep Enter-to-reload and Esc-to-return behavior consistent.

### Slice 3 — saved loadouts in the dashboard — implemented

- Add compact saved-loadout rows to `/construct`.
- Running a saved loadout from the dashboard should expand to package operations with no duplicate installs.
- Saved rows show active/disabled/available/unloaded member counts, mark member package rows with `[·]` while focused, and quick-select member package rows with Space.

### Slice 4 — sharing and saved-loadout removal — implemented

- Add `/construct share <saved-name>` to print a JSON snippet for a saved loadout.
- Add `/construct remove <saved-name>` to delete only the saved loadout recipe.
- Add `/construct import` for pasted snippets with preview/confirmation before writing; in TUI, no-arg import opens a paste box.
- Add share/import/remove smoke coverage with disposable projects and disposable HOME; confirm import writes manually in TUI until a safe interactive harness exists.

## Non-goals for now

- No global auto-run.
- No executable install script generation.
- No broad resource browser or replacement for `pi config`.
- No packaging/copying arbitrary local files.
- No direct project-local resource inclusion in saved loadouts/share snippets until a portable path/export model is designed.
- No append/merge behavior when saving over an existing loadout.
- No live links between saved loadouts and projects that ran them.
