# the-construct Planning Notes

> Working name: **the-construct** — a global Pi extension that lets us enter a project and choose the local Pi gear we want to load into that project: extensions, skills, prompt-command templates, themes, and package bundles.

## Goal

Keep Pi lean by default, but make project-level capabilities easy to discover, declare, enable, disable, update, and share using Pi's existing project-local configuration model.

the-construct is **not** a new package manager. It is a friendly loadout manager for idiomatic Pi project config: `.pi/settings.json`, project-local resources, and project packages.

MVP workflow:

1. Pi resolves project trust first, before the-construct does any project setup.
2. A user runs `/construct load` in the current Pi project directory.
3. the-construct shows the target directory and writes only project-local Pi declarations.
4. For packages, loading means the same durable action as `pi install <source> -l --approve` once; after that, `.pi/settings.json` persists the package and Pi installs missing project packages after trust.
5. the-construct records only its own management metadata in `.pi/construct.json`.
6. Pi reloads or asks for reload so newly loaded project resources are available.
7. Later, `/construct status`, `/construct enable`, `/construct disable`, and `/construct remove` manage the current project's loaded Construct items.

Optional autoload is **auto-offer only**. It may show `Load it into the Construct?` in new trusted projects, but it must never silently install or enable project code.

Construct library sync is **remember-only**. When Construct sees project-level package declarations, it may remember their source strings in the user's Construct library so they appear in future `/construct load` menus. It must never install, enable, copy, or execute anything by itself.

## Existing Pi primitives we should build on

- **Project trust**: project-local `.pi/settings.json`, `.pi/extensions`, `.pi/skills`, `.pi/prompts`, `.pi/themes`, `.pi/SYSTEM.md`, `.pi/APPEND_SYSTEM.md`, and `.agents/skills` load only after trust.
- **Context files**: repo-root/ancestor `AGENTS.md` and `CLAUDE.md` are normal Pi project guidance and can be part of a workflow, though they are not gated the same way as `.pi` resources.
- **Trust belongs to Pi**. Global extensions can technically participate in the `project_trust` event, but `the-construct` should not own, replace, or track trust decisions in MVP.
- **Project package installs** already exist: `pi install <source> -l` writes to `.pi/settings.json`; after that, Pi installs missing project packages on startup after trust. No `-l` churn is needed on every run.
- **Project-local auto-discovery** already exists: `.pi/extensions/`, `.pi/skills/`, `.pi/prompts/`, and `.pi/themes/` are discovered after trust without extra settings in many cases.
- **Resources**:
  - extensions: TypeScript modules, can add tools and slash commands.
  - skills: progressive capability docs/scripts, optionally `/skill:name` commands.
  - prompt templates: project-level slash commands from `.pi/prompts/*.md`.
  - themes: project/user themes.
  - packages: npm/git/local bundles containing any of the above.
- **Resource filtering** already exists in settings object form:
  ```json
  {
    "packages": [
      {
        "source": "npm:my-package",
        "extensions": ["extensions/main.ts"],
        "skills": ["skills/review"],
        "prompts": [],
        "themes": []
      }
    ]
  }
  ```
- **Runtime reload**: after settings/resource changes, `/reload` or `ctx.reload()` from an extension command refreshes resources.

## Alignment with idiomatic Pi

Construct should generate and manage the same files a careful Pi user would write by hand:

1. Keep `~/.pi/agent/settings.json` bare: provider auth/core defaults only, not a pile of always-on workflow resources.
2. Put repo behavior in the repo: `.pi/settings.json`, `.pi/skills/`, `.pi/prompts/`, `.pi/extensions/`, `.pi/themes/`, `.pi/SYSTEM.md`, plus `AGENTS.md`/`CLAUDE.md` when appropriate.
3. Package reusable cross-project assets as Pi packages and list them per project under `.pi/settings.json` `packages`.
4. Trust is handled by Pi before project setup. Construct should not bypass, replace, or track trust.

Construct's value is not a new resource system. Its value is packaging these idioms into a friendly "load this workflow into this project" experience.

## UX sketch

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

Enabled in this project
  [x] browser-tools        npm:@scope/pi-browser-tools
  [x] audit-kit            npm:@scope/pi-audit-kit

Available from Construct
  [ ] review-prompts       npm:@scope/pi-review-prompts
  [ ] local-tools          ../pi-tools                    local path

Project-local only
  local-helper             .pi/extensions/local.ts        not portable yet

Groups
  website: browser-tools, review-prompts
  script: audit-kit

Actions
  Toggle selected
  Enter source manually
  Forget from Construct library
  Reload
  Cancel
```

The toggle is intentionally simple:

- unchecked → checked means **enable in this project** with `pi install <source> -l --approve` and record/update `.pi/construct.json`.
- checked → unchecked means **disable in this project** by removing that package declaration from this project's `.pi/settings.json` and recording `enabled: false` in `.pi/construct.json`.
- disabling does **not** remove the source from the Construct library.
- forgetting removes the source from the Construct library only; it should not edit the current project unless the user separately disables it.

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

### Autoload flow

Autoload is opt-in and user-local:

```text
/construct autoload on
/construct autoload off
```

`/construct status` should include autoload state. `/construct autoload status` may exist as a convenience, but it should not be the only way to see autoload state.

When autoload is on and Construct sees an eligible trusted project with no user-local skip entry, it may offer:

```text
Open Construct for this project?
  yes
  not now
  don't ask for this project
```

Rules:

- `yes` opens the same `/construct load` menu.
- `not now` writes nothing.
- `don't ask for this project` writes user-local skip state, not project files.
- Autoload must never install anything by itself.
- Non-interactive modes must not prompt.

### Project scenarios

**Brand-new empty project**

- `/construct load` shows the Construct library and manual source entry.
- Enabling an item writes `.pi/settings.json` and `.pi/construct.json`.
- Nothing is installed until selected.

**Existing project with plain Pi package declarations**

- Construct detects packages from `.pi/settings.json`.
- It adds those package source strings to the Construct library if missing.
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

- `/construct` — print the same useful information as `/construct status` in print/non-UI mode; open the Construct menu in TUI mode once the menu exists.

Current implemented commands:

- `/construct status` — show target cwd, trust/load availability, autoload state, user catalog path/count, project Construct metadata, project package declarations, managed packages, and runtime diagnostics.
- `/construct load [source-or-catalog-id]` — choose or enter a package source and install it project-locally.
- `/construct load --dry-run <source-or-catalog-id>` — preview the package load without writing.
- `/construct enable <managed-id>` — re-add a previously disabled Construct-managed package to this project.
- `/construct disable <managed-id>` — disable a Construct-managed package for this project without deleting caches or unrelated files.
- `/construct remove <managed-id>` — remove a Construct-managed package from this project and from `.pi/construct.json` after confirmation.
- `/construct catalog` — list/add/remove package sources in the user's reusable library.
- `/construct autoload on|off|status` — enable, disable, or inspect auto-offer behavior.
- `/construct reload` — reload resources after changes.

Next planned behavior should avoid extra command sprawl:

- `/construct load` becomes the main menu/toggle UI.
- `/construct status` syncs and reports detected package declarations.
- `/construct catalog` remains the simple way to list or forget Construct library items.
- Future profiles are named groups of library items, not a separate package system.

Post-MVP commands can add profile save/apply, import/export, local-file packaging, and richer TUI dashboards only when the simple library/toggle flow is solid.

## Proposed architecture

the-construct should be a **global extension** installed in `~/.pi/agent/extensions/` or as a global Pi package. It manages project resources but does not itself live inside each project.

The global `the-construct` extension should be lightweight: commands, user catalog, autoload auto-offer, and project-local package management only for MVP. The actual workflow resources should be declared project-locally whenever possible.

### Main pieces

1. **Command layer**
   - Register `/construct` and MVP subcommands.
   - `/construct` and `/construct status` should print the useful current state; do not require rich TUI for MVP.
   - Guard interactive flows with `ctx.hasUI` / `ctx.mode === "tui"` as appropriate.

2. **Autoload layer**
   - Do not participate in Pi's trust prompt for MVP.
   - Do not track Pi trust decisions in Construct state.
   - Autoload is disabled by default.
   - If enabled, `session_start` may auto-offer `/construct load` only after Pi trust/resource resolution and only in UI-capable modes.
   - Store autoload settings and per-project skips in user-local Construct files, not in project files.

3. **Construct library/catalog layer**
   - MVP catalog is user-only: `~/.pi/agent/construct/catalog.json`.
   - Catalog entries are package sources the user can load into future projects.
   - Whenever Construct sees package declarations in the current project's `.pi/settings.json`, it should remember missing source strings here.
   - Manual catalog add/remove stays simple; removing from the catalog means “forget from Construct,” not “disable in this project.”
   - No official/bundled/project catalog in MVP unless needed for local testing.

4. **Project state layer**
   - Target project is `ctx.cwd` for MVP. Do not guess git root.
   - Project settings: `.pi/settings.json` remains the source Pi already understands.
   - Construct metadata: `.pi/construct.json` tracks only items Construct loaded/disabled/removed for this project.
   - No lock file in MVP.

5. **Declaration/reconciler layer**
   - For package load, prefer Pi package commands:
     - `pi install <source> -l --approve` to add/install.
     - `pi remove <source> -l --approve` to remove when appropriate.
   - After initial add, treat `.pi/settings.json` as the durable declaration. Construct should not rerun `pi install -l` every startup.
   - Use direct JSON edits only when needed for Construct metadata and simple enable/disable bookkeeping.
   - Always create a timestamped backup before editing `.pi/settings.json` directly.
   - After changes, run `ctx.reload()` from a command context or prompt the user to `/reload`.

6. **Inventory layer**
   - Read `.pi/settings.json` to know current project package declarations.
   - Read `.pi/construct.json` to know Construct-managed item state.
   - Read project-local resource directories (`.pi/extensions`, `.pi/skills`, `.pi/prompts`, `.pi/themes`) for detected/project-bound inventory.
   - Classify package declarations as enabled here, available from Construct, disabled by Construct metadata, local path, project-local only, or drifted.
   - Use `pi.getCommands()`, `pi.getAllTools()`, and `pi.getActiveTools()` for status/diagnostics only; runtime inventory is not the source of truth.

7. **UI layer**
   - MVP path: `ctx.ui.select`, `ctx.ui.confirm`, `ctx.ui.input`, and clear text status.
   - Rich TUI `SettingsList` can wait until after package load/enable/disable/remove is solid.
   - Non-TUI/RPC/print modes should never block unexpectedly; status can print, prompts should skip or require explicit command input.

## Data model draft

### User Construct settings: `~/.pi/agent/construct/settings.json`

```json
{
  "version": 1,
  "autoload": false
}
```

Rules:

- User-local only.
- Does not modify Pi global settings.
- `autoload: true` means auto-offer `/construct load` in new eligible projects, not auto-install.

### User Construct skips: `~/.pi/agent/construct/skips.json`

```json
{
  "version": 1,
  "projects": {
    "/absolute/path/to/project": {
      "skippedAt": "2026-06-15T00:00:00.000Z",
      "reason": "dont-ask"
    }
  }
}
```

Rules:

- Written only when the user chooses `don't ask for this project`.
- User-local only; never create project files just to remember a negative answer.
- Paths should be canonicalized as much as practical.

### User catalog: `~/.pi/agent/construct/catalog.json`

MVP catalog entries are package-first. Avoid executable command strings in machine-readable catalog metadata; Construct should generate Pi commands from structured fields.

```json
{
  "version": 1,
  "items": [
    {
      "id": "browser-tools",
      "name": "Browser tools",
      "kind": "package",
      "source": "npm:@org/pi-browser-tools",
      "description": "Browser automation extension and skills",
      "groups": ["website"]
    }
  ]
}
```

Rules:

- `source` is passed to `pi install <source> -l --approve` when loading into a project.
- Preserve source strings exactly. If a user enters a pinned npm version or git ref, keep it; do not invent pinning policy in MVP.
- Catalog membership means “available to load into a project,” not “currently installed.”
- `groups` are optional labels for simple future profile/toolbelt views, for example `website`, `script`, `review`, or `debug`.

### Project Construct metadata: `.pi/construct.json`

```json
{
  "version": 1,
  "managedBy": "the-construct",
  "loadedAt": "2026-06-15T00:00:00.000Z",
  "targetCwd": "/absolute/path/to/project",
  "items": {
    "browser-tools": {
      "kind": "package",
      "source": "npm:@org/pi-browser-tools",
      "requestedSource": "npm:@org/pi-browser-tools",
      "enabled": true,
      "managedReason": "loaded",
      "loadedAt": "2026-06-15T00:00:00.000Z",
      "updatedAt": "2026-06-15T00:00:00.000Z"
    }
  }
}
```

Rules:

- Metadata only. `.pi/settings.json` remains the Pi source of truth.
- If metadata and `.pi/settings.json` disagree, `/construct status` reports drift and settings win.
- Do not store secrets, env values, auth material, or generated package cache paths.
- Do not write `.pi/construct.json` for `not now` or `don't ask` answers.
- `managedReason` can be `loaded`, `synced`, `enabled`, or future values. Syncing records that Construct noticed an existing declaration; it should not imply Construct originally installed the package.

## Post-MVP: Shareable project profiles/templates

Yes: a project's Construct config should be saveable as a reusable profile/template.

Keep it low-tech: a template is just a JSON file containing selected recipe ids, package sources, filters, and optional project config templates. It should not contain secrets.

Suggested locations:

- `.pi/construct.profile.json` — share this repo's recommended loadout.
- `.pi/construct.profiles/*.json` — multiple project/team templates.
- `~/.pi/agent/construct/profiles/*.json` — user's personal reusable templates.

Example:

```json
{
  "version": 1,
  "name": "web-app-standard",
  "description": "Browser/search/review setup for web app repos",
  "items": [
    {
      "id": "pkg:browser-tools",
      "source": "npm:@org/pi-browser-tools",
      "enabled": true,
      "config": {
        "files": [".pi/browser-tools.json"],
        "env": ["BROWSER_TOOLS_API_KEY"]
      }
    },
    {
      "id": "prompt:review",
      "enabled": true
    }
  ]
}
```

### One-click apply

The friendly flow should be:

```text
Load it into the Construct? y/n

Found project profile: web-app-standard
Apply 5 items to this project?

  + npm:@org/pi-browser-tools
  + npm:@org/pi-review-prompts
  + prompt:review
  + skill:brave-search
  + .pi/browser-tools.json template

[Apply] [Customize] [View details] [Cancel]
```

`Apply` means:

1. add package entries to `.pi/settings.json` and run `pi install -l` only for package sources that need to be added/installed now.
2. apply package filters to `.pi/settings.json`.
3. create missing project-local resources/config files from templates.
4. skip/ask on existing files.
5. write `.pi/construct.json`.
6. offer reload.

### Editing, removing, overwriting

Keep the UI simple and file-backed.

Main commands:

- `/construct` — dashboard.
- `/construct edit` — edit current project's loadout.
- `/construct save-profile` — save current loadout as a profile/template.
- `/construct apply-profile` — apply a saved profile to this project.
- `/construct remove` — remove selected managed items from this project.
- `/construct reset` — remove Construct management metadata, optionally leave installed resources.

Simple edit flow:

```text
Construct dashboard

Current project: web-app-standard

[ ] pkg:browser-tools       installed, managed
[x] prompt:review           installed, managed
[ ] skill:brave-search      available

Actions: Apply changes / Save as profile / Remove selected / Details / Cancel
```

Overwrite rules:

- Existing `.pi/settings.json`: merge, do not blindly replace.
- Existing package entry: update in place after confirmation.
- Existing config file: ask `Keep / Overwrite / Diff / Save as .new`.
- Existing prompt/skill file: ask before overwrite.
- Removing a Construct item should remove or disable only what Construct manages, unless user chooses `force`.
- Secrets are never overwritten or written by default.

Profiles should be plain JSON so users can fix them by hand. Friendly UI on top, boring files underneath.

## Construct library, inventory, and profile model

The picker should stay simple. Construct has one user-local **library** of package sources, plus project-local state that says whether each source is enabled here.

Sources for the `/construct load` menu:

1. **User Construct library**
   - Stored at `~/.pi/agent/construct/catalog.json`.
   - Contains package sources we have seen or added.
   - This is the list shown in future projects.
   - Construct may automatically add package sources it detects in trusted project `.pi/settings.json`. This is a remember-only action.

2. **Current project package declarations**
   - Read from `.pi/settings.json` `packages`.
   - Anything declared here is enabled in the current project.
   - If a package source is missing from the user library, Construct should add it so it appears in future `/construct load` menus.

3. **Project Construct metadata**
   - Read from `.pi/construct.json`.
   - Tracks what Construct toggled and the last known enabled/disabled state.
   - Advisory only; `.pi/settings.json` wins when there is disagreement.

4. **Project-local resources**
   - Read from `.pi/extensions`, `.pi/skills`, `.pi/prompts`, `.pi/themes`.
   - Show these as “project-local only.”
   - Do not add raw local files to the reusable package library. They need a future profile/export/package flow.

5. **Runtime inventory**
   - `pi.getCommands()`, `pi.getAllTools()`, and `pi.getActiveTools()` are useful for status/diagnostics.
   - Runtime inventory is not enough to reinstall a resource elsewhere, so it is not the source of truth.

### Library sync principle

Construct should remember project-level package sources automatically because this tool is for our own local workflow and we want future projects to see what we have used before.

Rules:

- Sync runs during `/construct status`, `/construct load`, and other explicit Construct commands.
- Sync reads package declarations from the current trusted project's `.pi/settings.json`.
- Sync appends missing package sources to the user library.
- Sync never installs anything.
- Sync never enables anything in another project.
- Sync never copies project-local files.
- Sync dedupes by exact source string.
- Local/relative/absolute path package sources can be remembered, but should be labeled `local path` because they may not work from other projects.

This replaces separate “scan/promote/adopt/remember” commands for now. We can add more control later if the library gets noisy, but the first version should optimize for a tiny personal toolbelt.

### Enable/disable model

For the user, this is a toggle:

- **Enabled here**: package source exists in this project's `.pi/settings.json` `packages`.
- **Available**: package source exists in the Construct library but not in this project's `.pi/settings.json`.
- **Disabled here**: Construct metadata remembers the user toggled it off here. Practically, this means it is absent from `.pi/settings.json` and still present in the library.

Disable/uninstall wording:

- In Construct UI, call it **disable** because the source remains available in Construct.
- Implementation can remove the package declaration from the project. That is effectively uninstalling it from this project.
- Do not delete caches, package checkouts, generated files, or config files.
- Do not remove from the Construct library unless the user chooses “forget.”

### Groups and future profiles

Groups are lightweight labels on library items:

```json
{
  "id": "browser-tools",
  "kind": "package",
  "source": "npm:@org/pi-browser-tools",
  "groups": ["website", "debug"]
}
```

For now, groups only organize the menu. Later, a profile is just a named group/loadout of library item ids plus optional notes/config:

```text
website → browser-tools, review-prompts, search-tools
script  → audit-kit, cli-helper
```

Future profile flow:

```text
/construct load
Choose group/profile: website
Toggle all website items on for this project? y/n
```

This keeps the long-term profile goal without adding many commands now.

Suggested labels in UI:

- `enabled` — declared in the current project's `.pi/settings.json`.
- `available` — in the Construct library, not enabled here.
- `disabled` — previously toggled off here by Construct.
- `local path` — package source is a local path and may not be portable.
- `project-local only` — raw `.pi` file/directory resource; not reusable until exported/packaged.
- `group:<name>` — optional library grouping/profile label.

## Config strategy

Extensions, skills, prompts, and themes may require configuration. Some config belongs globally, but a lot of it should be project-level.

the-construct should support project-level config as part of each recipe:

- `.pi/settings.json` additions/overrides.
- package resource filters.
- extension-specific config files under `.pi/`, for example `.pi/browser-tools.json`.
- local prompt/skill/template files copied from trusted templates.
- environment variable requirements, documented but not written into project files unless explicitly requested.
- setup notes or post-install checks.

Rules:

- Do not assume every package is zero-config.
- Show required config before apply/setup.
- Ask before overwriting project config files.
- Prefer project-local config for project behavior.
- Keep secrets out of committed `.pi` files by default; use env var references or ignored local config files.

## Settings strategy

Use `.pi/settings.json` as the canonical Pi configuration.

Important path rule: paths in `.pi/settings.json` resolve relative to the `.pi` directory. So prefer `"prompts": ["prompts"]` over `"prompts": [".pi/prompts"]`. Also, many standard project resource directories are auto-discovered, so settings entries are only needed when adding non-standard paths or package entries.

Idiomatic project output should look like this for a Go CLI project:

```json
{
  "defaultModel": "claude-sonnet-4-20250514",
  "defaultThinkingLevel": "low",
  "packages": ["npm:@foo/pi-go"],
  "skills": ["../.agents/skills/go-cli"],
  "prompts": ["prompts"],
  "extensions": ["extensions/go.ts"]
}
```

If the resources live in auto-discovered project locations like `.pi/prompts/` and `.pi/extensions/`, Construct can often omit those explicit `prompts`/`extensions` entries entirely.

### Install package locally

Equivalent user action:

```bash
pi install npm:@org/pi-browser-tools -l --approve
```

Settings result:

```json
{
  "packages": ["npm:@org/pi-browser-tools"]
}
```

### Disable selected package resources

Use package object filters:

```json
{
  "packages": [
    {
      "source": "npm:@org/pi-browser-tools",
      "extensions": ["extensions/browser.ts"],
      "skills": [],
      "prompts": [],
      "themes": []
    }
  ]
}
```

Rules:

- Package-level enable/disable means add/remove the package entry.
- Resource-level enable/disable means convert string package entry to object form and adjust filters.
- Prompt-template commands can be enabled/disabled individually.
- Skill commands are controlled by enabling/disabling the skill, or globally by `enableSkillCommands`.
- Extension slash commands are controlled by enabling/disabling the extension that registers them; the-construct cannot safely toggle individual commands inside an extension unless that extension provides its own config.

## Load, sync, and toggle flow details

### `/construct load` in a new project

Scenario: user opens a repo that has no `.pi/settings.json` and no `.pi/construct.json`.

1. User runs `/construct load` or accepts the autoload offer.
2. Construct treats `ctx.cwd` as the target project.
3. Construct syncs current project package declarations into the user library; likely no-op in an empty project.
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

1. User runs `/construct load` or `/construct status`.
2. Construct reads `.pi/settings.json` and detects package declarations.
3. Construct adds missing source strings to the user library.
4. The menu shows those sources as enabled here.
5. The same sources now appear as available options in other projects.
6. Nothing is reinstalled just because Construct remembered it.

### `/construct load` in a project already managed by Construct

Scenario: project has `.pi/construct.json`.

1. Construct syncs `.pi/settings.json` package declarations into the user library.
2. Construct merges library entries, project package declarations, and Construct metadata into one toggle list.
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
/construct status
```

or:

```text
/construct load
```

Construct sees `npm:@org/pi-audit-kit` in `.pi/settings.json` and adds it to the user library if missing. It is now available in new and old projects through `/construct load`, but it does not install into those projects until toggled on.

### Autoload

1. User explicitly enables auto-offer with `/construct autoload on`.
2. On `session_start`, after Pi has resolved project trust/resource loading, Construct checks:
   - `ctx.hasUI` is true.
   - Project is trusted according to `ctx.isProjectTrusted()` when project-local resources are relevant.
   - The canonical project path is not in user-local skips.
   - Autoload is enabled in user-local Construct settings.
3. If eligible, Construct asks:

   ```text
   Open Construct for this project?
     yes
     not now
     don't ask for this project
   ```

4. `yes` opens the same `/construct load` menu.
5. `not now` writes nothing.
6. `don't ask for this project` writes only user-local skip state.
7. Non-interactive modes never prompt.
8. Autoload may sync package source strings from `.pi/settings.json`, but it must never install or enable packages by itself.

### Enable / disable / forget

- Enable means add the package source to this project's `.pi/settings.json` with `pi install <source> -l --approve`, set Construct metadata `enabled: true`, and offer reload.
- Disable means remove the package declaration from this project's `.pi/settings.json`, set Construct metadata `enabled: false`, and offer reload.
- Forget means remove the source from the user Construct library. It does not change any project by itself.
- Remove/delete wording should be avoided in the main UI except for “forget from library,” because project-level disable is the normal uninstall-from-this-project action.
- Never delete package caches, copied files, or config files unless Construct created and tracks them and the user explicitly confirms cleanup. MVP should avoid file cleanup entirely.

## Conflicts and maintenance risks

### Runtime and resource conflicts

- **Command name collisions**: multiple extensions or prompt templates can register the same command. Pi suffixes duplicate extension commands, but the UX can get confusing.
- **Tool name collisions**: extensions can override built-in tools or each other. This is powerful but dangerous; the-construct should warn clearly.
- **Package duplication**: the same package can exist globally and project-locally. Pi's package identity rules make the project entry win, but users need visibility.
- **Settings merge surprises**: project settings override/merge with global settings. the-construct should show effective state and project-only state separately.
- **Resource filters**: package object filters can disable resources in subtle ways. MVP should avoid partial resource toggles unless we later need them.
- **Reload lifecycle**: after changing settings, old extension instances continue until reload completes. Treat `ctx.reload()` as terminal for the command handler.
- **Trust boundary confusion**: project trust is Pi's responsibility and is not a sandbox. the-construct should not add its own trust language beyond showing package/file changes before applying.
- **Non-interactive mode**: print/json modes cannot prompt. Autoload auto-offer must skip safely.
- **Offline/network failures**: package install/update may fail or be intentionally disabled. Keep dry-run and already-installed management useful offline.
- **Project-specific resources**: local prompts/skills/extensions may contain repo-specific assumptions. Do not add raw local files to the reusable package library automatically.

### Maintenance challenges as Pi updates

- **Extension API changes**: `ExtensionAPI`, command context methods, TUI helpers, and metadata shapes may evolve.
- **Settings schema changes**: package filter semantics, resource keys, or trust behavior may expand.
- **CLI behavior changes**: shelling out to `pi install`, `pi remove`, or `pi update` is stable conceptually, but output text should not be parsed unless necessary.
- **TUI component changes**: rich custom UI built on `SettingsList`/`SelectList` may require occasional adjustment.
- **Package manifest conventions**: new resource types may appear later; schema should tolerate unknown fields.
- **Resource metadata gaps**: `pi.getCommands()` and `pi.getAllTools()` reveal loaded runtime state, not every installable item in an uninstalled package.

Mitigations:

- Use documented APIs only; avoid importing Pi internals.
- Keep all Pi-facing calls behind a small adapter layer.
- Prefer Pi CLI commands for install/remove/update instead of recreating package-manager behavior.
- Avoid parsing human CLI output; inspect settings and known files instead.
- Add a `piVersionTested` field to construct metadata/lock files.
- Build compatibility checks into `/construct doctor`.
- Make the catalog schema forward-compatible: ignore unknown fields, preserve comments/unknown metadata where possible.
- Keep MVP UI simple before investing in deep custom TUI.

## Update strategy

the-construct should distinguish between **Pi itself**, **global Construct catalog/resources**, and **project-installed resources**.

### Package updates

For resources installed into a project by the-construct, updates are primarily **project-level updates**. The project `.pi/settings.json` controls what that project has loaded, and the installed package checkout/cache lives under the project `.pi/` scope when installed with `-l`.

Use Pi's package update commands wherever possible:

```bash
pi update --extensions
pi update --extension <source>
```

For project resources, run from the project directory and pass trust override only when appropriate:

```bash
pi update --extensions --approve
```

Rules to surface in UI:

- Versioned npm specs like `npm:@scope/pkg@1.2.3` are pinned and skipped by package updates.
- Unversioned npm specs may move when updated.
- Git refs are pinned tags/commits; Pi reconciles the checkout to the configured ref but does not advance it to a newer ref automatically.
- To move a pinned git package, update the configured source/ref explicitly.
- Local path packages are not updated by Pi; the-construct can only reload or re-read them.

### Construct-managed updates

Add commands:

- `/construct apply` — save selected Construct settings, declare packages/resources in project config, and install missing packages with `-l` when needed.
- `/construct update` — update/reconcile all construct-managed project packages.
- `/construct update <item>` — update one managed item.
- `/construct check-updates` — dry-run/update status where possible.
- `/construct pin <item> <version-or-ref>` — change a package source to a pinned version/ref.
- `/construct doctor` — report stale/missing/failed resources.

### Global vs project updates

There are two separate update tracks:

1. **Global arsenal/catalog updates**
   - Updates the-construct itself and the user's reusable picker recipes.
   - Does not automatically mutate existing projects.
   - Good for discovering newer recommended versions.

2. **Project loadout updates**
   - Updates packages installed in the current project with `-l`.
   - May modify the project's package checkout/cache and settings/ref pins.
   - Should be run intentionally per project, because each repo may need a stable toolchain.

Recommended behavior:

- `/construct update` updates/reconciles the current project's construct-managed resources.
- `/construct catalog update` updates the picker/catalog only.
- `/construct apply` declares selected recipes in the current project's Pi config and uses their saved `-l` command/source only when adding/installing a package.
- Existing projects do not silently change just because the global catalog changed.

### Catalog updates

The catalog is separate from installed packages.

- Bundled catalog updates when the-construct updates.
- User catalog/library updates when the user edits it, imports a catalog/profile, enters a source manually, or Construct sync remembers package declarations from a trusted project.
- Project catalog updates through normal project file changes.

### Lock file

Optional `.pi/construct.lock.json` can record:

- source string used at install time.
- package identity.
- last resolved path/version/ref when known.
- resources enabled/disabled.
- install/update timestamp.
- Pi version and the-construct version.

The lock file is informational at first; Pi's real source of truth remains `.pi/settings.json`.

## Safety principles

- Never install, execute, or load project-managed code outside Pi's existing project-resource/trust flow.
- Show source strings before install: npm package, git repo/ref, or local path.
- Pin git refs in recommended catalog entries when possible.
- Make destructive actions explicit: remove package, overwrite prompt files, disable extension.
- Keep a backup of `.pi/settings.json` before edits: `.pi/settings.json.bak.<timestamp>`.
- Treat skills as powerful: they can tell the model to execute scripts.
- Treat extensions as full-code-execution: they run with user permissions.
- Offline mode should skip network package discovery and only manage already-known local/catalog resources.
- Learn mode must never install, execute, or validate remote package code; it only records source strings already declared by trusted project config.
- `defaultProjectTrust: "always"` is a personal-machine convenience, not something Construct should recommend for shared/untrusted repos.

## Version-control policy

Construct should make it clear which files are meant to be committed and which are local cache/state.

Usually commit/share:

- `.pi/settings.json` when the team wants the same Pi loadout.
- `.pi/prompts/`, `.pi/skills/`, `.pi/themes/`, and project-safe `.pi/extensions/` when they are authored for the repo.
- `.pi/construct.json` if the team wants Construct to know the project has a managed loadout and which profile applies.
- `.pi/construct.profile.json` or exported Construct scripts when sharing loadouts.
- `AGENTS.md`/`CLAUDE.md` project guidance.

Usually do not commit:

- `.pi/npm/` and `.pi/git/` package caches/checkouts.
- `.pi/construct.lock.json` unless the team decides it wants reproducibility metadata.
- secret-bearing config files.
- machine-specific local path recipes.

Git ignore policy is out of scope for MVP. Construct should show changed files after apply and let the user's normal git workflow decide what to commit or ignore.

## Implementation status

Current code implements the initial package loop:

- `/construct` and `/construct status`.
- User catalog/library list/add/remove.
- Project-local package load via `pi install <source> -l --approve`.
- `.pi/construct.json` metadata writes.
- Disable, enable, and remove for Construct-managed package items.
- Autoload user setting plus conservative TUI-only auto-offer.
- Disposable smoke test in `scripts/smoke.sh`.

Need to simplify/adjust from the current code:

- Treat the catalog as the Construct **library**: a remembered list of package sources.
- Sync package declarations from the current project into the library on `/construct status` and `/construct load`.
- Make `/construct load` the main toggle/menu flow.
- Treat disable as “remove/uninstall from this project, keep in Construct library.”
- Treat forget as “remove from Construct library, do not touch project.”
- Reduce command sprawl; do not add separate scan/promote/adopt/learn commands unless we later need them.
- Add group labels as the bridge toward future profiles.
- Add installed-package smoke test using disposable `HOME`.

## MVP scope

Build the smallest useful Construct loop for our local workflow:

1. Global extension with `/construct` command surface.
2. `/construct` and `/construct status` print useful current project state.
3. User-local Construct files:
   - `~/.pi/agent/construct/settings.json`
   - `~/.pi/agent/construct/catalog.json`
   - `~/.pi/agent/construct/skips.json`
4. Project-local Construct metadata: `.pi/construct.json`.
5. Project-local Pi source of truth: `.pi/settings.json`.
6. Construct library is the reusable list of package sources seen/added by us.
7. `/construct status` reads `.pi/settings.json`, remembers package sources in the library, and reports enabled/available/disabled state.
8. `/construct load` loads/toggles library items into the current `ctx.cwd`.
9. Enable uses `pi install <source> -l --approve`.
10. Disable removes the package declaration from this project and leaves the source in the Construct library.
11. Forget removes a source from the Construct library and does not touch project files.
12. `/construct autoload on|off` toggles auto-offer only; no auto-install.
13. Backup `.pi/settings.json` before direct edits.
14. Ask for `/reload` or call `ctx.reload()` from command flow.

Explicitly out of MVP:

- Separate scan/promote/adopt/learn command family.
- Bundled official catalog.
- Project catalogs.
- Lock file.
- Rich dashboard TUI beyond a simple picker/toggle.
- Resource-level package filters.
- Copying prompt/skill/theme files.
- Project-type detection.
- Package update/pinning UX.
- Managing `AGENTS.md`, `CLAUDE.md`, `.pi/SYSTEM.md`, or `.pi/APPEND_SYSTEM.md`.

## Phase plan

### Phase 1 — Keep current package loop working

- Keep explicit extension load working:
  ```bash
  pi --no-extensions -e .
  ```
- Keep `./scripts/smoke.sh` green.
- Add installed-package smoke test with disposable `HOME`.
- Do not touch live global Pi config during development.

### Phase 2 — Library sync

- Rename user-facing “catalog” language toward “Construct library” while preserving file path/schema compatibility.
- On `/construct status`, read current project `.pi/settings.json` package declarations.
- Add missing package sources to `~/.pi/agent/construct/catalog.json`.
- Dedupe by exact source string.
- Label local/relative/absolute path sources as `local path`.
- Do not write project files during sync.

### Phase 3 — Simple toggle semantics

- Update status/menu language:
  - enabled here
  - available from Construct
  - disabled here
  - local path
  - project-local only
- Make disable remove the package declaration from `.pi/settings.json` and mark metadata `enabled: false`.
- Make enable add/install the package declaration and mark metadata `enabled: true`.
- Keep source in the library after disable.
- Add/keep backups before direct `.pi/settings.json` edits.

### Phase 4 — `/construct load` menu

- In TUI mode, `/construct load` shows the simple library toggle menu.
- In print/non-UI mode, `/construct load <source-or-id>` remains deterministic.
- Menu supports:
  - toggle selected on/off for this project;
  - enter source manually;
  - forget from Construct library;
  - reload;
  - cancel.
- Keep `/construct catalog` as low-level list/add/remove until we replace/rename it cleanly.

### Phase 5 — Groups and profile groundwork

- Add optional `groups` to catalog/library items.
- Show grouped lists in `/construct load`.
- Add a simple way to edit group labels, probably through `/construct catalog add <source> [id] --group website` or a later UI action.
- Do not implement full profile apply until the simple toggle library feels right.

### Phase 6 — Future profile/loadout work

- Profiles/loadouts as named sets of library item ids.
- Export/import readable Construct scripts.
- Local-file packaging/export for `.pi/extensions`, prompts, skills, themes.
- Resource-level filters only if we truly need partial package enablement.
- Doctor/update commands.
- Project-type recommendations like `website` or `script` once groups are useful.

## Core development TODO

Next agent session checklist:

- [ ] Run `./scripts/smoke.sh` before changes.
- [ ] Add disposable installed-package smoke script.
- [ ] Implement library sync from current project `.pi/settings.json` into `~/.pi/agent/construct/catalog.json`.
- [ ] Update `/construct status` output to say library/available/enabled instead of catalog/promotable language.
- [ ] Keep `/construct catalog` working for now as the low-level library editor.
- [ ] Change `/construct disable` messaging to “disabled from this project; still available in Construct.”
- [ ] Confirm disable removes only the project package declaration and never removes from library.
- [ ] Add/adjust smoke assertions for disable + library persistence.
- [ ] Sketch the first simple TUI `/construct load` toggle menu after sync/status behavior is solid.
- [ ] Run explicit package smoke: `pi --no-extensions -e . -p '/construct status'`.
- [ ] Run installed-package smoke with disposable `HOME`.
- [ ] Update `HANDOFF.md` after implementation.

## What might not work / missing pieces

This idea is workable, but a few things need to stay honest:

### 1. Pi can install packages, but it cannot infer intent

Pi can discover packages/resources/settings, but it cannot always know:

- why a resource was installed.
- whether it is safe for other projects.
- which config values are required.
- whether a prompt/skill is generic or repo-specific.
- whether a package should be pinned or floating.

So Construct needs explicit recipes/profiles. Detection is useful, but management should require intent. Promotion may be manual or automatic only when the user has enabled library sync, and library sync must stay limited to safe package source strings.

### 2. Extension config is not standardized

Different extensions may read config from different places:

- `.pi/settings.json`
- custom `.pi/*.json` files
- environment variables
- package-local files
- hardcoded defaults
- global user config

Construct can support common project-level config patterns, but extension authors may need to document or provide Construct recipes for best results.

Future nice-to-have: extensions can optionally ship a `construct` manifest describing config fields, defaults, and setup prompts.

### 3. Removing things cleanly is hard

Install is easier than uninstall.

A package may create files, modify settings, add prompts, require npm/git folders, or leave project config behind. Construct should default to safe removal:

- disable/remove the package entry from `.pi/settings.json`.
- remove files only if Construct created and tracks them.
- leave unknown files alone.
- offer a `force cleanup` only with explicit confirmation.

### 4. One-click install can still require human setup

Some resources need credentials, API keys, browser binaries, CLIs, local daemons, language runtimes, etc.

Construct should make this friendly by showing post-install checks:

```text
Needs setup:
  - BROWSER_TOOLS_API_KEY env var missing
  - gh CLI not authenticated
  - npm install failed in package checkout
```

But it should not pretend every loadout is truly one-click.

### 5. Sharing across machines is lossy

A profile can share package sources and config templates. It should not include:

- secrets.
- machine-specific absolute paths.
- local-only package paths unless explicitly marked local.
- generated package caches under `.pi/npm` or `.pi/git`.

Profiles should prefer npm/git sources over local paths for portability.

### 6. Other agents will not understand Construct automatically

Pi can load Construct because it is a Pi extension. Other coding agents will not understand `.pi/construct.profile.json` unless they add support.

For other agents/friends/users, export should include simple artifacts they can run or inspect:

- a plain profile JSON.
- a shell script with `pi install ... -l` commands.
- copied prompt/skill files where appropriate.
- a README explaining required env vars and setup.

### 7. Pi trust still comes first

A shared profile is still code/config from someone else. Pi's normal project trust flow comes first. Construct should not track trust; it should display package sources and file changes before applying.

### 8. Remembering everything has hard limits

Construct can remember package **sources** from `.pi/settings.json`; it cannot reliably turn every local resource into a reusable cross-project artifact.

Not automatically portable:

- raw `.pi/extensions/*.ts` files that import project code.
- prompts/skills that reference repo-specific commands, paths, or conventions.
- local package paths outside the project.
- config files with machine-specific paths or secrets.
- runtime-only tools/commands that do not expose their install source.

For these, Construct should detect and label the item, then offer future export/profile/package flows. If the user wants something available everywhere, the idiomatic path is to package it as a Pi package or export a readable loadout/profile.

### 9. Maintaining remembered catalogs can get noisy

If library sync is too aggressive, the user catalog becomes cluttered. To keep it maintainable:

- sync only runs during explicit Construct commands or accepted autoload menu flow.
- remembered entries should be removable/forgettable.
- dedupe by exact source string.
- label local/private/questionable entries clearly, especially local paths.
- provide future cleanup commands only if the library becomes noisy.

### 10. Idiomatic boundary

This remains idiomatic Pi if Construct writes normal Pi project declarations and keeps its own metadata advisory:

- `.pi/settings.json` is still source of truth for Pi behavior.
- project package install still goes through `pi install <source> -l --approve`.
- disable removes the project package declaration while keeping the source in the Construct library.
- local resources are detected, not secretly copied or globally enabled.
- user catalog is only a picker/source list, not an alternative package manager.

It becomes non-idiomatic if Construct starts hiding project behavior in global state, auto-installing on session start, or inventing resource loading outside Pi's trust/settings model.

### 11. Dynamic cwd-based profiles are a future idea

A power user could write a global extension that uses `resources_discover` and `before_agent_start` to load resources based on `ctx.cwd`. That is great for one person's machine, but it is less transparent for teams and friends because the project itself does not declare the workflow.

Construct should prefer project-local, versionable config by default. Dynamic cwd-based profiles should be saved for a future version as a setting, plugin, or companion extension idea.

## Exporting and sharing profiles

Yes: Construct should be able to export a project loadout so another Pi user, another project, or a teammate can load into the Construct.

Keep sharing low-tech and inspectable.

### Recommended export format: one readable Construct script

Do not split profile vs script for MVP. The friendliest artifact should be **one readable shell script** that is also a Construct profile.

Working name:

```text
construct-web-app-standard.sh
```

Why this wins:

- can be pasted in Discord.
- can be read by a human before running.
- can be executed directly by a Pi user.
- can be imported by the-construct by parsing a small embedded metadata block.
- does not require someone to understand Construct before benefiting from the share.

The file should contain:

1. comments describing what it applies.
2. plain `pi install ... -l` commands for package declarations/adds.
3. optional mkdir/write steps for non-secret project config/templates.
4. required env var notes.
5. an embedded Construct profile block for richer import.

### Metadata format

Decision for MVP: **keep machine-readable config as JSON**.

TOML is friendlier to skim, but adding it means:

- another parser/dependency.
- two profile syntaxes to document.
- possible drift between TOML export and JSON project state.
- more maintenance when Pi settings/package schemas evolve.

The script itself is the human-readable part: comments plus plain `pi install ... -l` commands. The embedded JSON block is for the-construct import, not something users should need to study closely.

Rules:

- `.pi/settings.json` stays JSON because Pi owns it.
- `.pi/construct.json` stays JSON because Construct project state should match Pi's config style.
- exported scripts use readable bash commands and comments.
- embedded profile metadata uses JSON for import.
- TOML can be reconsidered later only if JSON metadata becomes a real UX problem.

Example:

```bash
#!/usr/bin/env bash
set -euo pipefail

# Construct profile: web-app-standard
# Applies the same Pi project loadout I used here.
# Review this file before running. Extensions execute with your user permissions.
#
# Required env vars after install:
#   BROWSER_TOOLS_API_KEY  optional, enables remote browser service

pi install npm:@org/pi-browser-tools -l --approve
pi install npm:@org/pi-review-prompts -l --approve

mkdir -p .pi

# Optional non-secret project config template.
if [ ! -f .pi/browser-tools.json ]; then
  cat > .pi/browser-tools.json <<'JSON'
{
  "headless": true
}
JSON
fi

cat > .pi/construct.json <<'JSON'
{
  "version": 1,
  "loaded": true,
  "profile": "web-app-standard",
  "managedBy": "the-construct",
  "items": {
    "npm:@org/pi-browser-tools": { "enabled": true },
    "npm:@org/pi-review-prompts": { "enabled": true }
  }
}
JSON

printf '\nDone. Start pi and run /reload, or restart pi.\n'

# --- the-construct-profile begin json ---
# {
#   "version": 1,
#   "name": "web-app-standard",
#   "description": "The Pi loadout used in this project",
#   "notes": "Generated by the-construct. No secrets included.",
#   "env": ["BROWSER_TOOLS_API_KEY"],
#   "items": [
#     {
#       "source": "npm:@org/pi-browser-tools",
#       "applyCommand": "pi install npm:@org/pi-browser-tools -l --approve"
#     },
#     {
#       "source": "npm:@org/pi-review-prompts",
#       "applyCommand": "pi install npm:@org/pi-review-prompts -l --approve"
#     }
#   ]
# }
# --- the-construct-profile end ---
```

### How import works

`/construct import construct-web-app-standard.sh` should:

1. detect the `the-construct-profile` block.
2. show the install commands and config writes.
3. offer actions:
   - `Apply to this project`
   - `Add to my Construct picker`
   - `View script`
   - `Cancel`
4. if applied, run the saved `-l` commands only as needed to add/install packages, then write tracked project config.

If no metadata block exists, Construct can still inspect the script and say:

```text
This looks like a plain install script.
I found these commands:
  pi install npm:@org/pi-browser-tools -l --approve
  pi install npm:@org/pi-review-prompts -l --approve

Import as a basic Construct profile? yes/no
```

### Discord/paste sharing

For Discord, the exported script can be pasted as a code block. The friend can either:

```bash
# save as construct-web-app-standard.sh, then:
bash construct-web-app-standard.sh
```

or, if they already have the-construct:

```text
/construct import construct-web-app-standard.sh
```

Avoid encouraging blind `curl | bash`. The point is readability.

### When a bundle is still needed

Use a folder/zip only when the profile includes larger local prompts, skills, scripts, or config templates that are awkward to embed in one file:

```text
construct-web-app-standard/
  README.md
  install.sh
  prompts/
    review.md
  config/
    browser-tools.json.example
```

But the default export should stay one script.

### Export commands

Keep commands simple:

- `/construct export` — default: write one readable Construct script.
- `/construct import <script-or-folder>` — import/apply a script or bundle.
- `/construct save-profile` — save current project loadout into the user's picker without exporting.

Advanced/later:

- `/construct export-bundle` — write folder with script, README, prompts, skills, config templates.
- `/construct package` — turn a mature loadout into a real Pi package.

### Export UX

```text
Export Construct script

This will create one readable script:
  ./construct-web-app-standard.sh

Include project-local prompts inline? yes/no
Include project-local skills inline? no, bundle recommended
Include config templates inline? yes/no
Include secrets? no, never

Actions: Export / Preview / Cancel
```

### Import UX

```text
Import Construct script: web-app-standard

This script wants to apply:
  + npm:@org/pi-browser-tools
  + npm:@org/pi-review-prompts

It may write:
  + .pi/construct.json
  + .pi/browser-tools.json

Required env vars:
  ! BROWSER_TOOLS_API_KEY

Actions: Apply to this project / Add to picker / View script / Cancel
```

## Open questions

MVP decisions already made:

- User-facing verb is `/construct load`, not `/construct init` or `/construct arm`.
- `/construct status` should include autoload status; no separate status command is needed for autoload.
- Autoload means auto-offer only, never auto-install.
- Target project is `ctx.cwd` for MVP; do not guess git root.
- Skips are user-local and only written for `don't ask for this project`.
- Pinning is not an MVP policy. Preserve source strings exactly and let Pi's existing npm/git source semantics handle pinned versions/refs.
- Profiles/export are post-MVP.

Still open:

- Should `/construct load <source>` automatically add successful direct sources to the user catalog, or ask every time?
- What exact item id should Construct derive for ad hoc package sources when no catalog id exists?
- Should disable use `pi remove <source> -l --approve`, direct `.pi/settings.json` edits, or a reversible disabled list in `.pi/construct.json` plus settings edit?
- How should status phrase drift when `.pi/construct.json` says enabled but `.pi/settings.json` no longer contains the source?
- Should MVP support local path package sources, or start with npm/git only and add local paths immediately after?

## Recommended initial decisions

- Do not participate in, replace, or track Pi's trust flow for MVP.
- Align fully with idiomatic Pi: Construct manages project-local Pi config; it does not become a separate package manager.
- Keep global Pi config bare: provider auth/core defaults plus the global `the-construct` extension and user-local Construct catalog/settings only.
- Prefer project-local declarations: `.pi/settings.json`, `.pi/*` resources, and project packages. Treat `AGENTS.md`/`CLAUDE.md` as adjacent project guidance, not something Construct manages in MVP.
- Reusable cross-project assets should become Pi packages and be listed per project rather than loaded globally by default.
- Use Pi CLI for package add/remove/update where possible; use direct JSON edits for Construct metadata and conservative settings adjustments only when needed.
- Treat extension commands as part of their parent extension; do not attempt per-command toggles in MVP.
- Commit `.pi/settings.json` when teams want shared project loadouts; keep `.pi/construct.lock.json` optional/local unless reproducibility needs it.
- Build the package load/disable/remove loop before profiles, export, project detection, or rich TUI.
