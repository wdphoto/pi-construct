# MVP contract

<!-- Source: the-construct-plan.md lines 5-70: Goal -->

## Goal

Keep Pi lean by default, but make project-level capabilities easy to discover, declare, enable, disable, update, and share using Pi's existing project-local configuration model.

the-construct is **not** a new package manager. It is a friendly loadout manager for idiomatic Pi project config: `.pi/settings.json`, project-local resources, and project packages.

True MVP workflow:

1. In project A, a user installs a Pi extension/package project-locally with normal Pi:
   ```bash
   pi install <source> -l
   ```
   The source can be npm, git, an absolute/relative local package directory, or a local extension file accepted by Pi.
2. Construct sees that source in project A's `.pi/settings.json` `packages` list and remembers it in the user's Construct library as an install source, not as a copied resource or script.
3. In project B, the user runs `/construct load`.
4. Construct shows a simple searchable/toggle list:
   - `[x]` already declared in this project;
   - `[ ]` remembered in the Construct library.
5. User selects a remembered item.
6. Construct runs the same local-project Pi install action:
   ```bash
   pi install <remembered-source> -l --approve
   ```
7. After that, management belongs to Pi and the project `.pi/settings.json`. Construct is only the friendly memory/picker.

MVP non-goals:

- Do not copy extensions from one project to another.
- Do not invent install scripts.
- Do not crawl registries or galleries.
- Do not manage internals of a loaded package.
- Do not own updates, dependency installs, package caches, or trust.

Possible MVP management affordance:

Lead with one simple checkbox list. A checked item means the source is declared in the current project's `.pi/settings.json`; an unchecked item means it is remembered in Construct but not installed into this project.

```text
[x] tally tools          npm:tally-tools
[ ] tripwire             /Users/me/code/tripwire
[ ] demo extension       /Users/me/code/foo/extensions/demo.ts
```

Primary action:

- unchecked → checked means **add/install into this project** by running:
  ```bash
  pi install <source> -l --approve
  ```

For MVP, checking the box is the main happy path. Unchecking/removal should be conservative and confirmed, because users may read the list as an installer more than a package manager.

Secondary project-local actions can exist behind an item action menu later:

1. **Disable in this project** — keep or adjust the project package declaration so resources stop loading, if Pi filters make that safe for the package form.
2. **Remove from this project** — prefer Pi's native removal path:
   ```bash
   pi remove <source> -l --approve
   ```
   or conservatively remove the matching package declaration from `.pi/settings.json` with a backup. For local path sources, this must not delete original local files.
3. **Forget from Construct** — remove the source from the user-local Construct library only; do not edit the current project.

Autoload/startup behavior is **out of the active MVP**. Construct must not prompt, open, sync, install, enable, copy, reload, or write files just because a project/session loads.

Construct library sync is **manual and remember-only**. When the user runs `/construct sync`, Construct may remember project-level package source strings in the user's Construct library so they appear in future `/construct load` menus. It must never install, enable, copy, or execute anything by itself.

<!-- Source: the-construct-plan.md lines 71-225: Current learning/sync model -->

## Current learning/sync model

A Pi package installed with `pi install <source> -l` is project-local. It persists in that project's `.pi/settings.json`; it does not automatically become known to other projects or to the user's Construct library.

Construct currently learns reusable package options from explicit user actions:

1. `/construct sync` to choose current-project package declarations from `.pi/settings.json`, or `/construct sync -a` to adopt all new declarations;
2. `/construct remember <source> [id]` or `/construct catalog add <source> [id]`;
3. `/construct load <source>` for direct/ad-hoc sources.

That means discovery is intentionally command-driven in the MVP. If a user installs a package locally with raw Pi commands, Construct will not know about it for other projects until the user runs `/construct sync` in that project.

### Automatic sync possibilities

Pi extensions can hook lifecycle events such as session startup and shutdown, so automatic Construct sync is technically possible. It is intentionally **not active** in the MVP.

Course correction: `/construct sync` is the explicit current-project memory command. Invisible/automatic sync belongs later behind an opt-in toggle:

```text
/construct sync
/construct sync status
```

Sync means "remember existing package declarations". It should be conservative: show package sources from the current project when the user runs `/construct sync`, adopt selected sources, and reserve adopt-all behavior for explicit `/construct sync -a`. It must never install, enable, copy, remove, update, reload, or execute anything.

### Automatic sync option matrix

| Option | Trigger | What it can learn | Pros | Cons | MVP stance |
| --- | --- | --- | --- | --- | --- |
| Manual sync | `/construct sync ...` | Current project package declarations | User-visible, debuggable, safest | User has to remember to run it | Active MVP |
| Command-time passive sync | Future explicit command flow | Current project package declarations | Already near user intent; no background surprises | Still only learns when Construct is used | Later |
| Startup/shutdown/reload automation | Lifecycle hooks | Current trusted project declarations | Library can stay fresh | Writes user state without a direct command; can feel spooky | Roadmap only, opt-in |

Recommended order:

1. Keep explicit `/construct sync` for the current project.
2. Add source classification and path normalization.
3. Reconsider opt-in automation only after explicit sync proves useful.

Lifecycle automation is disabled for MVP. If it returns, it must be opt-in and remember-only.

### Low-tech install memory model

A useful framing: Construct is an **install memory** for reusable local Pi installs.

When a user or Construct runs:

```bash
pi install <source> -l
```

Pi persists that source in the current project's `.pi/settings.json` packages list. Construct does not need to duplicate code or understand the package internals. It can simply remember the source string and later replay the equivalent local install in another project:

```bash
pi install <remembered-source> -l --approve
```

This keeps Construct low-tech:

- remember install sources, not arbitrary shell scripts;
- replay Pi's normal install command, not custom installers;
- let Pi own package resolution, install layout, trust, resource loading, updates, and cache management;
- keep `.pi/settings.json` as the project source of truth;
- keep `~/.pi/agent/construct/catalog.json` as user-local memory only.

Future opt-in automation can be implemented as a diff of package declarations, but the active MVP only runs this adoption when the user runs `/construct sync`.

This captures installs made outside Construct, including local installs done with raw Pi commands, as long as they resulted in package declarations. It does not capture arbitrary files copied into `.pi/extensions/` unless a future detector reports them as local-only resources.

Important distinction: remember **sources**, not "install scripts." We should avoid storing arbitrary commands. The replayable command is always derived by Construct as `pi install <source> -l --approve`.

### What should sync include?

Default sync should start with **package declarations only**:

- `packages` from project `.pi/settings.json`;
- `packages` from global `~/.pi/agent/settings.json` when requested;
- string and object package forms, preserving the original source string.

Package sources are the most portable Construct library item because they already represent bundles/loadouts.

Loose local resources should be detected but not automatically promoted into the main package library:

- `extensions` arrays in settings can point at loose files/directories;
- auto-discovered `.pi/extensions/`, `.pi/skills/`, `.pi/prompts/`, `.pi/themes/` are project-local resources, not reusable package sources;
- global `~/.pi/agent/extensions/` entries are user-local resources, not necessarily shareable packages.

Construct can classify these as "local resources" or "package candidates" later, but it should not pretend they are reusable packages unless the user packages them or explicitly adds the path.

### Source classification

Construct can distinguish where things came from by reading settings and, at runtime, by inspecting Pi resource provenance:

- project package declaration: `.pi/settings.json` `packages`;
- global package declaration: `~/.pi/agent/settings.json` `packages`;
- project explicit extension path: `.pi/settings.json` `extensions`;
- global explicit extension path: `~/.pi/agent/settings.json` `extensions`;
- project auto-discovered loose resources: paths under `.pi/extensions`, `.pi/skills`, `.pi/prompts`, `.pi/themes`;
- global auto-discovered loose resources: paths under `~/.pi/agent/extensions`, `~/.pi/agent/skills`, etc.;
- runtime commands/tools: `pi.getCommands()` and `pi.getAllTools()` expose `sourceInfo` with `path`, `scope`, `origin`, and source metadata.

For MVP sync, only package declarations should enter `catalog.json`, and only when the user explicitly runs `/construct sync` or `/construct remember`. Loose local paths can be reported in `/construct status` or a future `/construct doctor`, with suggestions like "package this if you want it reusable."

### Feasibility concerns to discuss

The install-memory plan is possible with documented Pi APIs, but these are the concerns to resolve deliberately:

1. **Lifecycle automation has no active MVP path.** If startup/shutdown/reload automation returns, it must be opt-in, remember-only, and best-effort.
2. **No true install event.** Pi does not document a `package_installed` event. Construct learns after the fact by reading `packages` declarations from settings. That means raw installs are remembered on the next explicit `/construct sync`, not at install time.
3. **Only package declarations are replayable.** Sources in `packages` can be replayed as `pi install <source> -l --approve`. Loose resources under `.pi/extensions`, `.pi/prompts`, `.pi/skills`, etc. are detectable but not automatically reusable install memories.
4. **Local paths need normalization.** Relative local package sources are resolved relative to the settings file that declared them. Construct should store absolute/real paths in the user library to make replay from another project work.
5. **Global sync can pollute the library.** `~/.pi/agent/settings.json` packages may be always-on personal tools, not project loadouts. `/construct sync global` should stay explicit if it is added later.
6. **Deduplication is harder than exact strings.** Pi deduplicates by npm package name, git repo without ref, and local resolved path. Construct currently mostly uses exact sources plus path normalization. Npm/git identity normalization is a follow-up.
7. **Toggle UI maps to package declarations, not resources.** The simple `[x]/[ ]` list should toggle whole package sources in `.pi/settings.json`. Fine-grained extension/skill/prompt filtering should use Pi filters later, not be invented now.
8. **Disable/remove wording matters.** Removing a project package declaration is not uninstalling caches or deleting code. The UI must say "remove from this project" or "disable in this project," not "uninstall".
9. **Concurrent settings writes are possible.** Pi/package commands may write settings while Construct also updates advisory metadata. Use conservative read/parse/write, avoid `.pi/settings.json` edits during sync, and consider backup/locking only if collisions appear.
10. **TUI quicksearch is implemented but still needs manual UX passes.** The current custom checkbox picker supports fuzzy typing, Space toggles, Enter saves, and Esc cancels for the dashboard/load/unload/sync flows.
11. **Construct metadata can drift.** `.pi/settings.json` is source of truth. `.pi/construct.json` is advisory and can become stale if users edit settings by hand. Status/toggle UI should compute current checked state from settings, not only metadata.
12. **Trust boundaries remain Pi's job.** Project package declarations load after trust. Construct must not bypass trust or silently install project code before Pi's normal trust flow.
13. **Extension environment assumptions can be messy.** Some packages expect environment variables, shell setup, local CLIs, credentials, MCP servers, language runtimes, or project-specific files. Construct should remember and replay package declarations, but it should not try to infer, copy, or synthesize env vars/secrets. Future diagnostics can report likely missing setup, but secrets stay out of Construct state.
14. **Package and extension setting files are not standardized.** A package may read its own dotfiles, write generated state, expect user-level config, or use custom settings outside Pi's manifest. Construct should treat those as package-owned behavior. If we support config later, it should be explicit per package/profile, previewed, and backed up rather than scraped automatically.
15. **Resource filters can hide complex package behavior.** Pi package object filters can include or exclude extensions, skills, prompts, and themes. Construct's current sync should ignore disabled/excluded declarations and preserve existing object-form filters when loading/unloading instead of flattening them into a plain source string.
16. **Global package declarations are out of scope for MVP sync.** We do not care about always-on global Pi config for Construct loadouts right now. `/construct sync` should focus on local project installs from `.pi/settings.json` so the library reflects project-portable loadout choices.
17. **Updates do not equal changelog delivery.** Pi can update npm/git package sources, but extension packages should not assume Pi will display their package version or changelog. Keep a repo `CHANGELOG.md`, and consider a future `/construct changelog` command if users need in-Pi release notes.

### Holes and course corrections

1. **Discovery is passive.** Add `/construct sync` so users do not have to chase old install commands manually.
2. **Relative local sources are fragile.** Convert local sources to absolute paths when adding to the user library, or store a `baseDir` alongside the source.
3. **Package identity is exact-string only.** Add normalization later for npm names, git repos without refs, and local realpaths.
4. **Disable is intentionally blunt.** Current behavior removes the project package declaration and marks Construct metadata disabled. Keep this for MVP but make the wording explicit.
5. **Library items are packages, not profiles yet.** Reserve room for future `kind: "profile"`, but do not build profile bundles until package-item behavior is solid.
6. **No package-gallery discovery yet.** A future `/construct discover` or curated seed catalog can help users find options without turning Construct into a package manager.

<!-- Source: the-construct-plan.md lines 1237-1271: MVP scope -->

## MVP scope

Build the smallest useful Construct loop for our local workflow:

1. Global extension with `/construct` command surface.
2. `/construct` and `/construct status` print useful current project state.
3. User-local Construct files:
   - `~/.pi/agent/construct/catalog.json`
4. Project-local Construct metadata: `.pi/construct.json`.
5. Project-local Pi source of truth: `.pi/settings.json`.
6. Construct library is the reusable list of package sources seen/added by us.
7. `/construct status` reads `.pi/settings.json` and reports enabled/available/disabled state without writing files.
8. `/construct load` loads/toggles library items into the current `ctx.cwd`.
9. Enable uses `pi install <source> -l --approve`.
10. Disable removes the package declaration from this project and leaves the source in the Construct library.
11. Forget removes a source from the Construct library and does not touch project files.
12. No autoload/startup behavior in the active MVP.
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

<!-- Source: current pivot: no active autoload -->

## Startup behavior

Construct has no active startup/autoload behavior in the MVP.

A project with no `.pi/construct.json` still opens the full loadout view when the user runs `/construct`. Read-only commands must not create metadata just to show project state.

Future onboarding automation can be reconsidered later as an explicit opt-in setting, but no lifecycle hook should prompt, open Construct, sync, install, reload, or write state today.

