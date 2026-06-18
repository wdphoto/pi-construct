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

Optional autoload is **auto-offer only**. It may show `Load it into the Construct?` in new trusted projects, but it must never silently install or enable project code.

Construct library sync is **remember-only**. When Construct sees project-level package declarations, it may remember their source strings in the user's Construct library so they appear in future `/construct load` menus. It must never install, enable, copy, or execute anything by itself.

<!-- Source: the-construct-plan.md lines 71-225: Current learning/sync model -->

## Current learning/sync model

A Pi package installed with `pi install <source> -l` is project-local. It persists in that project's `.pi/settings.json`; it does not automatically become known to other projects or to the user's Construct library.

Construct currently learns reusable package options from three places:

1. explicit user action: `/construct catalog add <source> [id]`;
2. `/construct load` in a project that already has package declarations in `.pi/settings.json`;
3. ad-hoc loads where the user chooses to remember the source in the Construct library.

That means discovery is intentionally passive in the MVP. If a user installs a package locally with raw Pi commands, Construct will not know about it for other projects until Construct sees that project and remembers the source.

### Automatic sync possibilities

Pi extensions can hook lifecycle events such as session startup and shutdown, so automatic Construct sync is technically possible. The safe version would remain **remember-only**:

- read package declarations from trusted project `.pi/settings.json`;
- optionally read global package declarations from `~/.pi/agent/settings.json`;
- add missing package sources to `~/.pi/agent/construct/catalog.json`;
- never install, enable, copy, remove, update, or execute anything.

Possible trigger points:

- **command-time sync**: sync when `/construct load`, `/construct status`, or `/construct sync` runs. This is explicit and easiest to reason about.
- **session_start sync**: remember packages when Pi starts in a trusted project. Useful, but it writes user state without a direct command, so it should likely be opt-in.
- **session_shutdown sync**: remember packages on exit. This is less intrusive during startup, but can be missed on crashes and may be surprising if a session changes directories.
- **post-install detection by diff**: Pi does not currently expose a dedicated "package installed" extension event in the documented API. Construct can approximate this by comparing project/global package declarations against its library on startup, reload, or command execution. If it sees unknown package sources, it can ask: "Add these to your Construct library?" This is detection after the declaration exists, not a true install hook.

Course correction: make `/construct sync` the explicit current-project memory command. Invisible/automatic sync is disabled for the MVP and belongs later:

```text
/construct sync
/construct sync status
```

Sync must not be conflated with autoload. Autoload means "offer to open Construct"; sync means "remember existing package declarations". A detection prompt should be conservative: show the source, scope (`project` or `global`), and target library path before writing `~/.pi/agent/construct/catalog.json`.

### Automatic sync option matrix

| Option | Trigger | What it can learn | Pros | Cons | MVP stance |
| --- | --- | --- | --- | --- | --- |
| Manual sync | `/construct sync ...` | Project/global package declarations and explicit extension paths | User-visible, debuggable, safest | User has to remember to run it | Build first |
| Command-time passive sync | `/construct load`, maybe `/construct status` | Current project package declarations | Already near user intent; no background surprises | Still only learns when Construct is used | Keep for `/construct load`; maybe add to `/construct status` later |
| Startup autosync | `session_start` | Current trusted project declarations; optionally global declarations | Library is fresh before user opens picker | Writes user state at startup; can feel spooky | Opt-in only, after `/construct sync` exists |
| Shutdown autosync | `session_shutdown` | Final current project declarations; optionally global declarations | Least intrusive during startup; can happen quietly after normal work | Missed on crash/kill; no good moment to ask; cwd/session changes can confuse target | Later only; disabled for MVP |
| Reload autosync | `resources_discover` / reload flow | Changed declarations after `/reload` | Catches package changes during active work | Reloads can happen for many reasons; still surprising | Only as part of opt-in autosync |
| Detection prompt | Startup/reload/command diff finds unknown sources | Unknown sources not in library | Friendly: "Add this to Construct?" | Prompt fatigue; bad for shutdown because user is leaving | Use for command-time/startup, not shutdown |

Recommended order:

1. Implement explicit `/construct sync` for the current project.
2. Add source classification and path normalization.
3. Add optional detection prompt for command-time or startup sync.
4. Reconsider opt-in silent shutdown sync only if explicit sync proves useful.

Shutdown autosync is attractive because it stays out of the way, but it is disabled for MVP. If we need to ask the user, startup or command-time is friendlier because the user is present and in context.

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

Autosync can be implemented as a diff of package declarations:

1. On session start or before shutdown, read current project `.pi/settings.json` packages.
2. Compare sources to `~/.pi/agent/construct/catalog.json`.
3. Add missing sources to the library if autosync is enabled, or offer to remember them during an explicit command.
4. Never mutate project settings during autosync.

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

For MVP sync, only package declarations should enter `catalog.json` automatically. Loose local paths can be reported in `/construct status` or a future `/construct doctor`, with suggestions like "package this if you want it reusable."

### Feasibility concerns to discuss

The install-memory plan is possible with documented Pi APIs, but these are the concerns to resolve deliberately:

1. **Shutdown autosync has no prompt window.** `session_shutdown` is documented and works for cleanup, but it is a bad moment to ask questions. If autosync runs there, it should be silent, opt-in, remember-only, and best-effort.
2. **No true install event.** Pi does not document a `package_installed` event. Construct learns after the fact by reading `packages` declarations from settings. That means raw installs are remembered on next sync/startup/shutdown, not at install time.
3. **Only package declarations are replayable.** Sources in `packages` can be replayed as `pi install <source> -l --approve`. Loose resources under `.pi/extensions`, `.pi/prompts`, `.pi/skills`, etc. are detectable but not automatically reusable install memories.
4. **Local paths need normalization.** Relative local package sources are resolved relative to the settings file that declared them. Construct should store absolute/real paths in the user library to make replay from another project work.
5. **Global sync can pollute the library.** `~/.pi/agent/settings.json` packages may be always-on personal tools, not project loadouts. `/construct sync global` should stay explicit; global autosync should be separate or avoided.
6. **Deduplication is harder than exact strings.** Pi deduplicates by npm package name, git repo without ref, and local resolved path. Construct currently mostly uses exact sources plus path normalization. Npm/git identity normalization is a follow-up.
7. **Toggle UI maps to package declarations, not resources.** The simple `[x]/[ ]` list should toggle whole package sources in `.pi/settings.json`. Fine-grained extension/skill/prompt filtering should use Pi filters later, not be invented now.
8. **Disable/remove wording matters.** Removing a project package declaration is not uninstalling caches or deleting code. The UI must say "remove from this project" or "disable in this project," not "uninstall".
9. **Concurrent settings writes are possible.** Autosync writes user Construct state while Pi/package commands may write settings. Use conservative read/parse/write, avoid project writes during sync, and consider backup/locking only if collisions appear.
10. **TUI quicksearch is feasible but custom.** Pi's `SettingsList` supports toggles and fuzzy search by label, so the desired searchable toggle list is feasible. It will require replacing the current `ctx.ui.select` picker with a custom `SettingsList` UI.
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

<!-- Source: the-construct-plan.md lines 1766-1788: Autoload once-per-project rule -->

## Autoload once-per-project rule

Construct autoload is startup/reload offer-only. It must not auto-install or invisibly sync anything.

The prompt `Load it into the Construct?` should be shown only once per trusted project, not on every reload.

Desired MVP behavior:

1. On `session_start`, after Pi trust is verified and UI is available, Construct may offer `Load it into the Construct? y/n`.
2. Ask only if this project has no user-local Construct project marker yet.
3. If user says yes:
   - open `/construct`;
   - record a user-local marker for this project, e.g. reason `accepted`.
4. If user says no:
   - record a user-local marker for this project, e.g. reason `declined`.
5. Do not ask again for that project on reload/startup unless the marker is manually cleared.
6. The marker must live in user-local Construct state, not project files, so Construct does not mutate a project just because it offered.

Implementation note:

- Existing `~/.pi/agent/construct/skips.json` can be reused short-term, but the concept is really `projects.json` / `seen projects`, not only skips.
- `maybeOfferAutoload` should record the marker on both accept and decline.
- Keep autoload separate from sync. Recording the marker must not install, sync, copy, enable, or edit `.pi/settings.json`.

