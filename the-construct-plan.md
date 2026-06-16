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

### MVP manual load flow

Primary command:

```text
/construct load
```

If the user's Construct catalog is empty:

```text
Your Construct catalog is empty.

Load a Pi package source into this project:
  npm:@scope/pi-browser-tools
  git:github.com/user/pi-extension@main
  ./local-pi-package
```

A direct source should also work:

```text
/construct load npm:@scope/pi-browser-tools
```

Before writing anything, Construct must show the target and the exact project-local effect:

```text
Load into this project?

Target:
  /path/to/current/cwd

Will update:
  .pi/settings.json
  .pi/construct.json

Package source:
  npm:@scope/pi-browser-tools

This is equivalent to:
  pi install npm:@scope/pi-browser-tools -l --approve

Actions: Load / Cancel
```

After load:

```text
Loaded npm:@scope/pi-browser-tools into this project.
Added to your Construct catalog for future projects? [yes/no]
Reload Pi resources now? [yes/no]
```

If the catalog has entries:

```text
Load into this project:

  browser-tools       npm:@scope/pi-browser-tools
  review-prompts      npm:@scope/pi-review-prompts
  local-tools         ../pi-tools

Actions: Load selected / Enter source / Cancel
```

### Autoload flow

Autoload is opt-in and user-local:

```text
/construct autoload on
/construct autoload off
```

`/construct status` should include autoload state, so a separate `autoload status` command is unnecessary.

When autoload is on and Construct sees a new trusted project with no `.pi/construct.json` and no user-local skip entry, it may offer:

```text
Load it into the Construct?
  yes
  not now
  don't ask for this project
```

Rules:

- `yes` opens the same `/construct load` picker.
- `not now` writes nothing.
- `don't ask for this project` writes user-local skip state, not project files.
- Autoload must never install anything by itself.
- Non-interactive modes must not prompt.

### Ongoing management

Primary command:

- `/construct` — print the same useful information as `/construct status` for MVP.

Useful MVP subcommands:

- `/construct status` — show target cwd, trust/load availability, autoload state, user catalog path/count, project Construct metadata, project package declarations, managed/detected packages, and pending reload hint.
- `/construct load [source]` — choose or enter a package source and install it project-locally.
- `/construct enable <item>` — re-add a previously disabled Construct-managed package to this project.
- `/construct disable <item>` — disable a Construct-managed package for this project without deleting caches or unrelated files.
- `/construct remove <item>` — remove a Construct-managed package from this project and from `.pi/construct.json` after confirmation.
- `/construct catalog` — list/add/remove package sources in the user's reusable picker.
- `/construct autoload on|off` — enable or disable auto-offer behavior.
- `/construct reload` — reload resources after changes.

Post-MVP commands can add profiles, import/export, updates, resource-level filters, prompt/skill copying, and richer TUI dashboards.

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

3. **Catalog layer**
   - MVP catalog is user-only: `~/.pi/agent/construct/catalog.json`.
   - Catalog entries are package sources the user can load into future projects.
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
      "description": "Browser automation extension and skills"
    }
  ]
}
```

Rules:

- `source` is passed to `pi install <source> -l --approve` when loading into a project.
- Preserve source strings exactly. If a user enters a pinned npm version or git ref, keep it; do not invent pinning policy in MVP.
- Catalog membership means “available to load into a project,” not “currently installed.”

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
      "enabled": true,
      "loadedAt": "2026-06-15T00:00:00.000Z"
    }
  }
}
```

Rules:

- Metadata only. `.pi/settings.json` remains the Pi source of truth.
- If metadata and `.pi/settings.json` disagree, `/construct status` reports drift and settings win.
- Do not store secrets, env values, auth material, or generated package cache paths.
- Do not write `.pi/construct.json` for `not now` or `don't ask` answers.

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

## Picker source and inventory model

The picker should not be magic. It should be built from several explicit sources, with clear labels:

1. **Bundled construct catalog**
   - Ships with the-construct.
   - Contains known-good package/loadout recommendations.
   - Best for common choices like planning mode, tool manager, permission gates, web/search skills, review prompts.

2. **User construct catalog**
   - Stored at `~/.pi/agent/construct/catalog.json`.
   - User-curated personal arsenal.
   - This is what makes resources reusable across future projects.

3. **Project construct catalog**
   - Optional `.pi/construct.catalog.json`, loaded only after trust.
   - Team/project-specific recommended loadouts.

4. **Current project inventory**
   - Read from `.pi/settings.json`, `.pi/extensions`, `.pi/skills`, `.pi/prompts`, `.pi/themes`, and package entries.
   - These items appear as already installed/detected for the current project.
   - They are not automatically promoted to the reusable user catalog.

5. **Current runtime inventory**
   - `pi.getCommands()` for loaded extension/prompt/skill commands.
   - `pi.getAllTools()` and `pi.getActiveTools()` for tools.
   - Useful for status and inspection, but not enough by itself to reinstall resources elsewhere.

### Are all local/project things added to the Construct?

No, not automatically.

All project-local things should be **shown** in `/construct status` as detected inventory. But they should only become reusable Construct catalog entries after an explicit action, such as:

- `/construct adopt` — mark existing project resources as managed by the-construct for this project.
- `/construct promote` — add a reusable entry to the user's global construct catalog for future projects.
- `/construct export-loadout` — create a shareable loadout from the current project.

Reason: project resources may be private, one-off, broken, or tightly coupled to the current repo. Automatically adding everything to the future-project picker would pollute the arsenal and could leak project-specific paths or package sources.

Suggested labels in UI:

- `catalog` — available to install.
- `installed` — configured in current project.
- `managed` — installed/configured by the-construct.
- `detected` / `unmanaged` — exists locally, but not owned by the-construct.
- `global` — installed at user scope, available in every project already.
- `promotable` — can be added to the user catalog after confirmation.

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

## Load and autoload flow details

### Manual load

1. User runs `/construct load` or `/construct load <source>`.
2. Construct treats `ctx.cwd` as the target project for MVP.
3. Construct shows the target path and exact files/commands involved before changing anything.
4. Construct creates `.pi/` as needed.
5. Construct loads selected package sources with Pi project scope:
   - `pi install <source> -l --approve`
6. Construct writes/updates `.pi/construct.json` to record the managed package item.
7. Construct offers to add the source to `~/.pi/agent/construct/catalog.json` for reuse in other projects.
8. Construct asks to reload. If running from a command context, call `ctx.reload()` and treat reload as terminal.

### Autoload

1. User explicitly enables auto-offer with `/construct autoload on`.
2. On `session_start`, after Pi has resolved project trust/resource loading, Construct checks:
   - `ctx.hasUI` is true.
   - Project is trusted according to `ctx.isProjectTrusted()` when project-local resources are relevant.
   - `.pi/construct.json` does not already exist.
   - The canonical project path is not in user-local skips.
   - Autoload is enabled in user-local Construct settings.
3. If eligible, Construct asks:

   ```text
   Load it into the Construct?
     yes
     not now
     don't ask for this project
   ```

4. `yes` opens the same load picker as `/construct load`.
5. `not now` writes nothing.
6. `don't ask for this project` writes only user-local skip state.
7. Non-interactive modes never prompt.

### Enable / disable / remove

- Disable means remove/deactivate the Construct-managed package declaration from this project's `.pi/settings.json`, keep Construct metadata with `enabled: false`, and offer reload.
- Enable means re-add the remembered package source to this project's `.pi/settings.json`/package declarations, set `enabled: true`, and offer reload.
- Remove means remove the package declaration and Construct metadata for that item after confirmation. Prefer `pi remove <source> -l --approve` when it matches the intended project-local package removal.
- Never delete package caches, copied files, or config files unless Construct created and tracks them and the user explicitly confirms cleanup. MVP should avoid file cleanup entirely.

## Conflicts and maintenance risks

### Runtime and resource conflicts

- **Command name collisions**: multiple extensions or prompt templates can register the same command. Pi suffixes duplicate extension commands, but the UX can get confusing.
- **Tool name collisions**: extensions can override built-in tools or each other. This is powerful but dangerous; the-construct should warn clearly.
- **Package duplication**: the same package can exist globally and project-locally. Pi's package identity rules make the project entry win, but users need visibility.
- **Settings merge surprises**: project settings override/merge with global settings. the-construct should show effective state and project-only state separately.
- **Resource filters**: package object filters can disable resources in subtle ways. UI needs to show “installed but filtered out.”
- **Reload lifecycle**: after changing settings, old extension instances continue until reload completes. Treat `ctx.reload()` as terminal for the command handler.
- **Trust boundary confusion**: project trust is Pi's responsibility and is not a sandbox. the-construct should not add its own trust language beyond showing package/file changes before applying.
- **Non-interactive mode**: print/json modes cannot prompt. Autoload auto-offer must skip safely.
- **Offline/network failures**: package install/update may fail or be intentionally disabled. Keep dry-run and already-installed management useful offline.
- **Project-specific resources**: local prompts/skills/extensions may contain repo-specific assumptions. Do not auto-promote them globally.

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
- User catalog updates only when the user edits it, imports a catalog, or promotes/adopts resources.
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

Current code implements the MVP package loop:

- `/construct` and `/construct status`.
- User catalog list/add/remove.
- Project-local package load via `pi install <source> -l --approve`.
- `.pi/construct.json` metadata writes.
- Disable, enable, and remove for Construct-managed package items.
- Autoload user setting plus conservative TUI-only auto-offer.
- Disposable smoke test in `scripts/smoke.sh`.

Still intentionally post-MVP:

- Profiles/loadouts.
- Import/export scripts.
- Resource-level filters.
- Rich dashboard TUI.
- Project/bundled catalogs.
- Doctor/update commands.

## MVP scope

Build the smallest useful Construct loop:

1. Global extension with `/construct` command surface.
2. `/construct` and `/construct status` print everything useful for the current project, including autoload state.
3. User-local Construct files:
   - `~/.pi/agent/construct/settings.json`
   - `~/.pi/agent/construct/catalog.json`
   - `~/.pi/agent/construct/skips.json`
4. Project-local Construct metadata: `.pi/construct.json`.
5. Project-local Pi source of truth: `.pi/settings.json`.
6. `/construct load [source]` loads a package into `ctx.cwd` with `pi install <source> -l --approve`.
7. `/construct load` can reuse package sources from the user's catalog in future projects.
8. `/construct enable`, `/construct disable`, and `/construct remove` manage Construct-loaded packages for the current project.
9. `/construct autoload on|off` toggles auto-offer only; no auto-install.
10. Backup `.pi/settings.json` before direct edits.
11. Ask for `/reload` or call `ctx.reload()` from command flow.

Explicitly out of MVP:

- Profiles/loadouts.
- Import/export scripts.
- Bundled official catalog.
- Project catalogs.
- Lock file.
- Rich dashboard TUI.
- Resource-level package filters.
- Copying prompt/skill/theme files.
- Project-type detection.
- Package update/pinning UX.
- Managing `AGENTS.md`, `CLAUDE.md`, `.pi/SYSTEM.md`, or `.pi/APPEND_SYSTEM.md`.

## Phase plan

### Phase 1 — Skeleton and status

- Create extension skeleton with `/construct` and `/construct status`.
- Resolve target as `ctx.cwd` and print it clearly.
- Read user Construct settings/catalog/skips, creating directories/files only when a command needs to write.
- Read `.pi/settings.json` and `.pi/construct.json` if present.
- Print:
  - target cwd
  - whether project appears trusted/usable from the current context
  - autoload on/off
  - user catalog path and item count
  - project package declarations
  - Construct-managed items and drift against `.pi/settings.json`
  - reload recommendation when changes were made in this command

### Phase 2 — Catalog and dry-run load

- Define package-only catalog schema.
- Add `/construct catalog` list/add/remove basics.
- Add `/construct load [source]` dry-run path that shows exact target, files, and `pi install` command.
- No package install yet.

### Phase 3 — Project package load

- Add package load via `pi.exec("pi", ["install", source, "-l", "--approve"])`.
- Write/update `.pi/construct.json` after successful load.
- Offer to add direct sources to user catalog.
- Offer reload; call `ctx.reload()` from command flow when accepted.

### Phase 4 — Enable / disable / remove

- Disable Construct-managed package declarations for current project.
- Enable disabled Construct-managed package declarations.
- Remove Construct-managed package declarations and metadata after confirmation.
- Prefer Pi CLI for add/remove; use conservative direct JSON edits only when needed.
- Always backup `.pi/settings.json` before direct edits.

### Phase 5 — Autoload auto-offer

- Add `/construct autoload on|off`.
- Include autoload status in `/construct status`.
- On `session_start`, if autoload is enabled and the project is eligible, offer `Load it into the Construct?`.
- Implement `not now` as no write and `don't ask for this project` as user-local skip.
- Never auto-install.

### Phase 6 — Post-MVP polish candidates

- Profiles/loadouts.
- Export/import readable Construct scripts.
- Resource-level filters using package object form.
- Rich `SettingsList`/dashboard UI.
- Project and bundled catalogs.
- Doctor/update commands.
- Project-type recommendations.
- Managing copied prompt/skill/theme templates.
- Optional dynamic cwd-based profile companion mode.

## What might not work / missing pieces

This idea is workable, but a few things need to stay honest:

### 1. Pi can install packages, but it cannot infer intent

Pi can discover packages/resources/settings, but it cannot always know:

- why a resource was installed.
- whether it is safe for other projects.
- which config values are required.
- whether a prompt/skill is generic or repo-specific.
- whether a package should be pinned or floating.

So Construct needs explicit recipes/profiles. Detection is useful, but adoption/promotion should require confirmation.

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

### 8. Dynamic cwd-based profiles are a future idea

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
