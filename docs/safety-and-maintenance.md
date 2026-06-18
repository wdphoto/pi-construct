# Safety and maintenance

<!-- Source: the-construct-plan.md lines 1063-1213: Conflicts and maintenance risks -->

## Conflicts and maintenance risks

### Runtime and resource conflicts

- **Command name collisions**: multiple extensions or prompt templates can register the same command. Pi suffixes duplicate extension commands, but the UX can get confusing.
- **Tool name collisions**: extensions can override built-in tools or each other. This is powerful but dangerous; the-construct should warn clearly.
- **Package duplication**: the same package can exist globally and project-locally. Pi's package identity rules make the project entry win, but users need visibility.
- **Settings merge surprises**: project settings override/merge with global settings. the-construct should show effective state and project-only state separately.
- **Resource filters**: package object filters can disable resources in subtle ways. MVP should avoid partial resource toggles unless we later need them.
- **Reload lifecycle**: after changing settings, old extension instances continue until reload completes. Treat `ctx.reload()` as terminal for the command handler.
- **Trust boundary confusion**: project trust is Pi's responsibility and is not a sandbox. the-construct should not add its own trust language beyond showing package/file changes before applying.
- **Non-interactive mode**: print/json modes cannot prompt. Construct has no startup prompt in the active MVP.
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

<!-- Source: the-construct-plan.md lines 1388-1512: What might not work / missing pieces -->

## What might not work / missing pieces

This idea is workable, but a few things need to stay honest:

### 1. Pi can install packages, but it cannot infer intent

Pi can discover packages/resources/settings, but it cannot always know:

- why a resource was installed.
- whether it is safe for other projects.
- which config values are required.
- whether a prompt/skill is generic or repo-specific.
- whether a package should be pinned or floating.

So Construct needs explicit recipes/profiles. Detection is useful, but management should require intent. Promotion into the reusable library is manual in the MVP (`/construct sync` or `/construct remember`) and must stay limited to safe package source strings.

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

- adoption only runs during explicit `/construct sync` or `/construct remember` commands.
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

