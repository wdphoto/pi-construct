# Architecture and data model

<!-- Source: the-construct-plan.md lines 530-677: Proposed architecture -->

## Proposed architecture

the-construct should be a **global extension** installed in `~/.pi/agent/extensions/` or as a global Pi package. It manages project resources but does not itself live inside each project.

The global `the-construct` extension should be lightweight: commands, user catalog, and project-local package management only for MVP. The actual workflow resources should be declared project-locally whenever possible.

### Main pieces

1. **Command layer**
   - Register `/construct` and MVP subcommands.
   - `/construct` should open the loadout dashboard in TUI mode and print a useful dashboard in print mode; `/construct status` stays read-only text.
   - Guard interactive flows with `ctx.hasUI` / `ctx.mode === "tui"` as appropriate.

2. **Startup behavior**
   - Do not participate in Pi's trust prompt for MVP.
   - Do not track Pi trust decisions in Construct state.
   - Do not prompt, open Construct, sync, install, reload, or write files from lifecycle hooks.
   - Future automation belongs behind an explicit opt-in toggle.

3. **Construct library/catalog layer**
   - MVP catalog is user-only: `~/.pi/agent/construct/catalog.json`.
   - Catalog entries are package sources the user can load into future projects.
   - `/construct sync` explicitly shows a selection menu for package declarations from the current project's `.pi/settings.json`; `/construct sync -a` adopts all new declarations.
   - Public commands should say library/remember/forget; `catalog.json` and `/construct catalog ...` remain compatibility/internal language.
   - No official/bundled/project catalog in MVP unless needed for local testing.

4. **Project state layer**
   - Target project is `ctx.cwd` for MVP. Do not guess git root.
   - Project settings: `.pi/settings.json` remains the source Pi already understands.
   - Construct metadata: `.pi/construct.json` tracks advisory Construct-managed items, including items loaded directly and items adopted by explicit `/construct sync`.
   - No lock file in MVP.

5. **Declaration/reconciler layer**
   - For package load, prefer Pi package commands:
     - `pi install <source> -l --approve` to add/install.
     - `pi remove <source> -l --approve` to remove when appropriate.
   - After initial add, treat `.pi/settings.json` as the durable declaration. Construct should not rerun `pi install -l` every startup.
   - Use direct JSON edits only when needed for Construct metadata and simple enable/disable bookkeeping.
   - Always create a timestamped backup before editing `.pi/settings.json` directly.
   - After changes, do not auto-reload; tell the user to run `/construct reload` or `/reload` when ready.

6. **Inventory layer**
   - Read `.pi/settings.json` to know current project package declarations.
   - Read `.pi/construct.json` to know Construct-managed item state.
   - Read project-local resource directories (`.pi/extensions`, `.pi/skills`, `.pi/prompts`, `.pi/themes`) for detected/project-bound inventory.
   - Classify package declarations as enabled here, available from Construct, disabled by Construct metadata, local path, project-local only, or drifted.
   - Use `pi.getCommands()`, `pi.getAllTools()`, and `pi.getActiveTools()` for status/diagnostics only; runtime inventory is not the source of truth.

7. **UI layer**
   - Current MVP has a custom searchable checkbox TUI for `/construct`, `/construct load`, `/construct unload`, and multi-item `/construct sync`.
   - Text/print mode remains deterministic through explicit commands like `/construct load <source-or-id>` and `/construct unload <source-or-id>`.
   - Non-TUI/RPC/print modes should never block unexpectedly; status can print, prompts should skip or require explicit command input.

## Data model draft

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
- Do not write `.pi/construct.json` from read-only commands such as `/construct status` or from lifecycle/startup behavior.
- `managedReason` can be `loaded`, `synced`, `enabled`, or future values. Syncing records that Construct noticed an existing declaration; it should not imply Construct originally installed the package.

<!-- Source: the-construct-plan.md lines 781-966: Construct library, inventory, and profile model -->

## Construct library, inventory, and profile model

The picker should stay simple. Construct has one user-local **library** of package sources, plus project-local state that says whether each source is enabled here.

Sources for the `/construct load` menu:

1. **User Construct library**
   - Stored at `~/.pi/agent/construct/catalog.json`.
   - Contains package sources we have seen or added.
   - This is the list shown in future projects.
   - Construct adds package sources from project `.pi/settings.json` only when the user explicitly runs `/construct sync` or `/construct remember`.

2. **Current project package declarations**
   - Read from `.pi/settings.json` `packages`.
   - Anything declared here is enabled in the current project.
   - If a package source is missing from the user library, `/construct sync` can adopt it explicitly so it appears in future `/construct load` menus.

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

Construct remembers project-level package sources only from explicit user actions. This keeps the library useful without background writes.

Rules:

- `/construct sync` reads package declarations from the current project's `.pi/settings.json` and opens a selection menu in TUI mode.
- `/construct sync -a` adopts all new current-project package declarations without the menu.
- `/construct remember <source> [id]` adds one explicit source to the library.
- Sync appends missing package sources to the user library and arms advisory `.pi/construct.json` metadata for the current project.
- Sync never installs anything.
- Sync never removes package declarations.
- Sync never enables anything in another project.
- Sync never reloads or copies project-local files.
- Sync dedupes by normalized/exact source string in the current MVP.
- Local/relative/absolute path package sources can be remembered, but should be labeled `local path` because they may not work from other machines.

This replaces separate “scan/promote/adopt/learn” commands for now. We can add more control later if the library gets noisy, but the first version should optimize for a tiny personal toolbelt.

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

