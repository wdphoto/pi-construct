# Commands and UX

<!-- Source: the-construct-plan.md lines 266-529: UX sketch -->

## UX sketch

### Load/unload profile direction

A useful mental model is:

```text
/construct load
/construct unload
/reload
```

`load` gets the current project into a selected Construct setup quickly. `unload` disarms that setup quickly. Pi's `/reload` or `ctx.reload()` then refreshes active resources.

For MVP, a "profile" should mean a set of remembered package/install sources, not a new package format and not copied resources.

Proposed behavior:

1. **`/construct`** opens the main checkbox interface.
2. **`/construct load`** is an alias for opening/applying the interface, or later for loading a named profile.
3. **`/construct unload`** removes or disables the currently active Construct-managed setup from this project.
4. After load/unload, Construct offers to reload Pi resources.

Safe MVP unload semantics:

- Only unload sources that are either:
  - recorded in `.pi/construct.json` as loaded by Construct; or
  - currently checked in the Construct UI and explicitly confirmed by the user.
- Prefer Pi's native project-local removal command:
  ```bash
  pi remove <source> -l --approve
  ```
- If Pi removal cannot target the exact declaration, fall back to conservative `.pi/settings.json` editing with a backup.
- Never delete local source files, npm caches, git clones, or package directories.
- Never remove sources from the user Construct library during unload.
- Reload after unload, or clearly tell the user to run `/reload`.

Possible UI:

```text
Construct — /path/to/project

[x] tally tools          npm:tally-tools
[x] tripwire             /Users/me/code/tripwire
[ ] demo extension       /Users/me/code/foo/extensions/demo.ts

Actions
  Space/Enter: add checked item to this project
  u unload checked Construct items from this project
  / search
  r reload
  q close
```

`unload` should feel like "disarm this project," not "forget this tool exists." Forgetting from the library remains a separate action.

How Pi and examples already handle similar ideas:

- Pi's native package removal is `pi remove <source> -l --approve`, which removes the package source from project settings.
- Pi's `pi config` opens a searchable/toggle resource configuration UI and uses space to toggle resources.
- Pi extension examples use settings/toggle UIs for simple enable/disable flows and reload prompts for runtime changes.

Confidence:

- We are confident about source-level `load`/`unload` using `pi install` and `pi remove` because these are documented/native Pi package operations.
- We should research/experiment more before claiming resource-level "disable" semantics, because package filters can be more subtle than source-level removal. MVP should use source-level load/unload first.

### Simple `/construct load` menu

Primary command:

```text
/construct load
```

`/construct load` should work in any trusted project directory. It is the one simple place to see the Construct library and toggle project-level packages on or off.

A direct source should also work without opening the picker:

```text
/construct load npm:@scope/pi-browser-tools
```

Before showing the menu, Construct syncs the current project into the user-local Construct library:

- read `.pi/settings.json` package declarations;
- remember package source strings in `~/.pi/agent/construct/catalog.json` if missing;
- do not install, enable, copy, execute, or rewrite anything just because it was detected;
- mark local/relative path sources as less portable, but still list them for us.

Menu sketch:

```text
Construct — /path/to/current/cwd

[x] browser-tools        npm:@scope/pi-browser-tools
[x] audit-kit            npm:@scope/pi-audit-kit
[ ] review-prompts       npm:@scope/pi-review-prompts
[ ] local-tools          /Users/me/code/pi-tools
[ ] local-helper         /Users/me/code/foo/extensions/local.ts

Actions
  Space/Enter: add checked item to this project
  / search
  a enter source manually
  r reload
  q close
```

The checkbox is intentionally simple:

- checked means **already declared in this project**.
- unchecked means **remembered in Construct, not declared in this project**.
- unchecked → checked means **add/install in this project** with `pi install <source> -l --approve` and record/update `.pi/construct.json`.
- checked → unchecked is not the main MVP flow. If supported, it should ask for a clear confirmation such as "Remove from this project?" and should never delete local source files.
- forgetting removes the source from the Construct library only; it should not edit the current project unless the user separately removes it from the project.

Before writing anything, Construct must show the target and exact project-local effect:

```text
Enable in this project?

Target:
  /path/to/current/cwd

Will update:
  .pi/settings.json
  .pi/construct.json

Package source:
  npm:@scope/pi-browser-tools

This is equivalent to:
  pi install npm:@scope/pi-browser-tools -l --approve

Actions: Enable / Cancel
```

For disable:

```text
Disable in this project?

Target:
  /path/to/current/cwd

Will update:
  .pi/settings.json
  .pi/construct.json

Package source:
  npm:@scope/pi-browser-tools

This removes the project package declaration only.
The source remains available in Construct for other projects.

Actions: Disable / Cancel
```

If the Construct library is empty and nothing reusable is detected, Construct should still be useful:

```text
Your Construct library is empty.

Options:
  Enter a Pi package source
  Cancel

Examples:
  npm:@scope/pi-browser-tools
  git:github.com/user/pi-extension@main
  ./local-pi-package
```

### Startup behavior

Autoload/startup behavior is removed from the active MVP.

Rules:

- Construct does not prompt when a project loads.
- Construct does not send `/construct` for the user.
- Construct does not sync, install, reload, or write files from lifecycle hooks.
- A project with no `.pi/construct.json` still opens the full loadout view when the user runs `/construct`; status reports missing metadata without creating it.

### Project scenarios

**Brand-new empty project**

- `/construct load` shows the Construct library and manual source entry.
- Enabling an item writes `.pi/settings.json` and `.pi/construct.json`.
- Nothing is installed until selected.

**Existing project with plain Pi package declarations**

- Construct detects packages from `.pi/settings.json` during explicit `/construct sync`.
- It adds those package source strings to the Construct library if missing only after that explicit command.
- It does not reinstall them just because it sees them.
- The next `/construct load` in any project shows those sources as options.

**Existing project with local `.pi` resources**

- Construct detects `.pi/extensions`, `.pi/prompts`, `.pi/skills`, and `.pi/themes`.
- These show as project-local only.
- They are not automatically added to the reusable package library because a raw local file is not a portable install source.
- Future export/package/profile flows can make them reusable.

**Old project opened after Construct remembered something elsewhere**

- Remembered library entries appear as available options.
- Nothing is installed into the old project until the user toggles an item on.
- If the old project already has that package declared, Construct shows it as enabled.

**Project already managed by Construct**

- `/construct load` shows current enabled/disabled state, not only new install options.
- Enabled items can be toggled off for this project.
- Disabled/library items can be toggled on for this project.
- Drift between `.pi/construct.json` and `.pi/settings.json` is shown; `.pi/settings.json` wins.

### Ongoing management

Primary command:

- `/construct` — open the remembered-source picker. Checked items are declared in this project; unchecked items are available to load.

Current MVP commands:

- `/construct` — main picker/install-memory interface.
- `/construct load [source-or-catalog-id]` — explicit/direct load path; installs the source project-locally with `pi install <source> -l --approve`.
- `/construct load --dry-run <source-or-catalog-id>` — preview the package load without writing.
- `/construct unload [source-or-catalog-id]` — source-level project unload with `pi remove <source> -l --approve`; does not delete local files or forget the library item.
- `/construct sync` — remember current project package sources in the Construct library; never installs or edits the project.
- `/construct sync status` — inspect manual sync state; invisible sync is disabled for MVP.
- `/construct status` — read-only diagnostics.
- `/construct reload` — reload resources after changes.

Power-user/compatibility commands can remain implemented but should not be the primary MVP surface:

- `/construct catalog ...` — low-level Construct library list/add/remove.
- `/construct enable|disable|remove ...` — older management verbs; prefer load/unload language.

Next planned behavior should avoid extra command sprawl:

- Improve `/construct` from a simple select picker into a searchable checkbox UI.
- `/construct catalog` can later become `/construct remember`/`forget`, but only after MVP load/unload/sync is solid.
- Future profiles are named groups of library items, not a separate package system.

Post-MVP commands can add profile save/apply, import/export, local-file packaging, and richer TUI dashboards only when the simple library/toggle flow is solid.

<!-- Source: the-construct-plan.md lines 967-1062: Load, sync, and toggle flow details -->

## Load, sync, and toggle flow details

### `/construct load` in a new project

Scenario: user opens a repo that has no `.pi/settings.json` and no `.pi/construct.json`.

1. User runs `/construct load`.
2. Construct treats `ctx.cwd` as the target project.
3. Construct does not auto-sync; `/construct sync` is the explicit adoption command.
4. Construct shows the library grouped by optional `groups`, plus `Enter source manually`.
5. User toggles one or more items on.
6. Construct shows the target path and exact files/commands involved before changing anything.
7. Construct creates `.pi/` as needed.
8. Construct enables selected package sources with Pi project scope:
   - `pi install <source> -l --approve`
9. Construct writes/updates `.pi/construct.json` with advisory toggle metadata.
10. Construct asks to reload. If running from a command context, call `ctx.reload()` and treat reload as terminal.

### `/construct load` in an existing project with plain Pi package declarations

Scenario: user previously ran plain Pi commands such as `pi install <source> -l`, or a teammate committed `.pi/settings.json`.

1. User runs `/construct sync`.
2. Construct reads `.pi/settings.json` and detects package declarations.
3. Construct adds missing source strings to the user library and records advisory project metadata.
4. The same sources now appear as available options in other projects.
5. Nothing is reinstalled just because Construct remembered it.

### `/construct load` in a project already managed by Construct

Scenario: project has `.pi/construct.json`.

1. Construct merges library entries, project package declarations, and Construct metadata into one toggle list.
3. Checked items are enabled here.
4. Unchecked items are available from the library.
5. Toggling on enables the package in this project.
6. Toggling off disables/removes the package declaration from this project only.
7. Drift is shown clearly; `.pi/settings.json` wins over metadata.

### Remembering project installs

Construct should remember project-level package installs without owning the install path.

Example:

```bash
pi install npm:@org/pi-audit-kit -l --approve
```

Later, in that project:

```text
/construct sync
```

Construct sees `npm:@org/pi-audit-kit` in `.pi/settings.json` and adds it to the user library if missing. It is now available in new and old projects through `/construct load`, but it does not install into those projects until toggled on.

### Enable / disable / forget

- Enable means add the package source to this project's `.pi/settings.json` with `pi install <source> -l --approve`, set Construct metadata `enabled: true`, and offer reload.
- Disable means remove the package declaration from this project's `.pi/settings.json`, set Construct metadata `enabled: false`, and offer reload.
- Forget means remove the source from the user Construct library. It does not change any project by itself.
- Remove/delete wording should be avoided in the main UI except for “forget from library,” because project-level disable is the normal uninstall-from-this-project action.
- Never delete package caches, copied files, or config files unless Construct created and tracks them and the user explicitly confirms cleanup. MVP should avoid file cleanup entirely.

