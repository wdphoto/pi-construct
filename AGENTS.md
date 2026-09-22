# AGENTS.md

This repo is for **pi-construct** / **The Construct**, a global Pi extension / Pi package centered on `/construct`.

This is a Pi-native project. Before reaching for external web docs, use Pi's installed local documentation, local examples, this repo's README/AGENTS guidance, and any local `apricity/` notes as the source of truth. Work smarter: verify against the APIs and behavior already on this machine.

Above all: keep Construct as close to native Pi as possible. Prefer Pi's existing APIs, commands, settings semantics, TUI components, and package/resource behavior over custom duplicate systems.

## Project intent

- Build a friendly loadout manager for idiomatic Pi project-local config.
- Do not build a new package manager.
- Do not rebuild broad Pi UX that already exists. Construct should complement native Pi flows, not fork them.
- The source of truth for project setup remains normal Pi files like `.pi/settings.json`, `.pi/prompts/`, `.pi/skills/`, `.pi/extensions/`, and project package declarations.
- Keep global Pi lean; the global extension provides commands, library/profile metadata, import/export, and onboarding only.

## Native-first development rules

- Before designing a feature, ask: “Does Pi already have this?” Check installed docs, exported APIs, CLI behavior, and local examples first.
- Prefer using Pi-native primitives directly: `SettingsManager`, `DefaultPackageManager`, Pi package filters, trust handling, reload behavior, extension command APIs, and TUI components/patterns.
- Treat native Pi commands as product references. For package resource enable/disable behavior, study and align with `pi config` before adding Construct UI.
- Avoid duplicating Pi's package manager, resource resolver, trust model, config editor, or reload mechanics. If Construct needs a friendlier path, build a thin workflow on top of the native primitive.
- Keep Construct metadata advisory. Do not invent a parallel source of truth when `.pi/settings.json` or Pi package declarations already express the state.
- If we discover a more idiomatic Pi API after implementing custom logic, call it out, recalibrate, and simplify rather than preserving duplication.
- Prefer small seams that can be replaced by native Pi APIs as they become public/exported.

## Docs roles

- `AGENTS.md` — agent operating rules and compact build context; read this first.
- `README.md` — main human user guide and public instruction source.
- `CHANGELOG.md` — shipped history.
- `apricity/` — ignored local stash for agent notes and detailed project documentation after `AGENTS.md`; this is where local MAP/TODO/HANDOFF/FAQ-style notes belong, and it is not shipped or tracked.

## Current implementation

- Entry point: `extensions/construct/index.ts`.
- Main command: `/construct`.
- Dashboard implementation: `extensions/construct/commands/dashboard.ts`.
- Load/unload implementation:
  - `extensions/construct/commands/load.ts`
  - `extensions/construct/commands/unload.ts`
- Package apply operations: `extensions/construct/package-ops.ts`.
- Status/diagnostics: `extensions/construct/status.ts`.
- Direct resource inventory: `extensions/construct/resources.ts`.
- Agent Skills repository adaptation: `extensions/construct/skill-repositories.ts`.

## Product model

Construct remembers Pi package source strings from project-local declarations and lets users arm/disarm projects from one loadout menu.

Keep versioning below `0.1.0` until the product is deliberately declared ready for `0.1.0`; `0.0.10`, `0.0.11`, etc. are acceptable.

Core loop:

1. Install a Pi package normally in a project:
   ```bash
   pi install <source> -l --approve
   ```
2. Run `/construct load` to add already-installed package declarations to the Construct library and adopt direct resources into project metadata.
3. Optionally run `/construct save <name>` to save the active Construct package-source grouping.
4. In another project, run `/construct` or `/construct run <name>` to enable remembered package sources.
5. After dashboard changes, press Enter on the final panel to reload Pi, or Esc to cancel reload and run `/reload` later.

Important files:

```text
.pi/settings.json                       # Pi project source of truth
.pi/construct.json                      # advisory Construct metadata
~/.pi/agent/construct/catalog.json      # user-local Construct library/profiles
```

## Current command surface

Primary public command:

- `/construct`

Support commands:

- `/construct status`
- `/construct scan`
- `/construct load`
- `/load <package-source ...>`
- `/construct unload`
- `/construct save <name>`
- `/construct list`
- `/construct run <saved-name>`
- `/construct share <saved-name>`
- `/construct wipe <saved-name>`
- `/construct import [json]`

Use Pi's normal `/reload` after loadout changes. Do not advertise or re-add `/construct reload`; dashboard Enter can call `ctx.reload()` internally.

`/construct run <saved-name>` is the explicit product-approved command for applying a saved loadout. Do not use `/construct run` as a dashboard alias.

Do not re-add public `sync`, `toggle`, `library`, `forget`, `catalog`, `enable`, `disable`, `on`, `off`, `remove`, or `reload` command paths without an explicit product decision. The top-level `/load <package-source ...>` command is approved as the thin, always-library-only command for adding explicit package sources to the global library without project adoption. `/construct scan [path]` is approved as a trusted local project report; no-arg scan may read Pi's trust store but must refuse broad/private roots, and TUI scan may load selected findings into Construct using `/construct load` write boundaries. `/construct wipe <saved-name>` is approved only for deleting saved loadout recipes, not project resources.

## Behavior rules

- `/construct` opens the Construct Loadout dashboard.
- Dashboard TUI title stays quiet and includes the package/version string plus counts.
- Dashboard row content is color-coded by state while cursor/checkbox markers stay plain: Loadouts/Saved and Active use the heading accent, Disabled is muted, Available is yellow, Unloaded/read-only is gray; focused row content may be bold; headings use the normal accent/heading color. A small Unresolved representation applies only to Construct-managed declared packages with zero Pi-resolved package resources, no discovered Agent Skills adapter, and no explicit whole-package disable; those carriers follow carrier state and whole-package-disabled declarations stay Disabled and never contribute to Active counts. Unadopted declarations stay read-only Unloaded with unresolved/all-off detail.
- `/construct load` adds already-installed current project package declarations to the Construct library and advisory current-project metadata; direct project resources are adopted into advisory current-project metadata only.
- `/construct load <explicit-source>` falls back to a library-only add when an explicit source does not match any project candidate (adoptable declaration, already-managed declaration, or `autoload: false` override). It remembers the source in the global Construct library without installing it, editing `.pi/settings.json`, creating `.pi/construct.json`, or recording a known project. The top-level `/load <package-source ...>` command is the thin, always-library-only command for that behavior. Construct recognizes explicit `npm:` specs (`npm:name`, `npm:@scope/name`, `npm:name@version`), conservative Git source forms (`git:`, `http://`, `https://`, `ssh://`, `git://`, `git@host:path`), and explicit local paths (`./`, `../`, `~/`, absolute file or directory) with its shared source-identity predicate; bare ids/resource names and bare `~`/`.`/`..` keep project-query semantics, while generated Pi cache paths are refused. Local paths are normalized at command time with the shared `normalizeSourceForLibrary` behavior (relative to `ctx.cwd`, `~` expansion, realpath when available) and the normalized absolute source is stored; a local path must exist and be readable, but Construct only records it and never installs, copies, scans, or inspects package structure. Local sources are machine-specific and break if the directory moves, and paths with whitespace are unsupported. Secret-like URLs or generated Pi cache paths are refused before normalization, like `/construct import`. Library-only adds do not require project trust; an explicit-source-only `/construct load` in an untrusted project is remembered library-only rather than adopted, while project declaration adoption keeps its trust gates and fresh write-time trust recheck.
- `/construct load` never installs packages, activates remembered package sources, reloads Pi, or enables disabled package filters. To activate a remembered package, use the dashboard/run flow or `pi install -l <source>`.
- `/construct unload` remains its own multi-select command: no arguments opens selection, while multiple queries unload matching rows. It removes resources from the Construct library/saved-loadout refs/current-project metadata only.
- Dashboard `Ctrl+U` acts only when checkboxes are selected and asks for explicit confirmation before unloading global Construct-library entries, saved-loadout references, and current-project metadata. `Ctrl+Alt+R` is the advertised project-package removal shortcut, retaining confirmation, its focused-row fallback, whole-package child handling, trust checks, and settings backups. Legacy `Ctrl+R` and forward Delete remain accepted but unadvertised compatibility inputs. Plain `r`/`R` (and `u`/`U` and `i`/`I`) remain filter text, including with selected rows. `Alt+I` opens details. Do not use `Ctrl+I`: it is legacy Tab.
- Only catalog-backed ordinary package rows are eligible for dashboard `u`, including Available, Active, Disabled, and Unresolved states. A complete package-child selection represents its whole package and requires the same confirmation. Partial child groups, direct resources, actual saved rows, Unloaded rows, and `autoload: false` override rows refuse the entire batch rather than being ignored or promoted. Saved-row Space remains member-package quick selection, not recipe deletion.
- Unload never uninstalls packages, installs packages, disables packages, filters resources, reloads Pi, or edits `.pi/settings.json`. Declarations can remain visible as Unloaded after reopening; do not promise to hide all rows or refresh live.
- If fresh trust is lost during dashboard unload, explicit global Construct-library cleanup may proceed but current-project metadata/index writes must skip with an honest partial warning. An initially untrusted dashboard remains read-only. Reuse the shared helper so dashboard and command behavior preserve unrelated state, including parsed profile fields/membership/`updatedAt`; do not promise raw catalog-byte preservation. Pi settings remain byte-identical. Do not add a new framework.
- `.pi/settings.json` wins when it disagrees with `.pi/construct.json`.
- `/construct status full` and `/construct` report direct project resources using Pi's native resolver; `/construct load` can adopt them into project metadata, and dashboard Enter toggles adopted direct resources with Pi-native `+path` / `-path` filters.
- Pi-resolved package resources determine known effective state: any enabled resource is Active, while one or more resolved resources with none enabled is all-off. A filtered partly-active package remains Active and must never be described as all-off. Package enable/disable is whole-package only for now for unfiltered or whole-package-disabled package declarations: disabling writes empty package resource filter arrays, enabling clears those all-empty filters, and an ordinary whole-package-disabled declaration remains enableable even if Pi resolves zero resources. If a package already has partial Pi package filters, Construct must not silently clobber them; route users toward `pi config -l` (with Construct's package resource picker retained as a compatibility workflow for ordinary project declarations).
- Pi package entries with `autoload: false` are project resource override deltas, not ordinary project package declarations. Construct must always show them read-only, exclude them from library/load/save/run/remove/toggle operations, and direct users to `pi config -l` for inherit/load/unload changes.
- `.pi/construct.json` is advisory metadata only.
- `/construct status` is read-only and must not create `.pi/construct.json`; print-mode `/construct scan` is read-only, while TUI `/construct scan` may create/update `.pi/construct.json` only when the user selects findings and presses Enter to load them. Read-only scan and its broad/private-root restrictions remain unchanged.
- Before every cross-project scan/reconcile Construct catalog, project-metadata, or known-project write—after waits and earlier operations—recheck native target trust. The canonical current project uses `ctx.isProjectTrusted()` exclusively, including session-only grants and denials; other targets use native persisted trust, including inherited trust and nearer-deny precedence. Discovery also honors an explicit current-session denial rather than falling back to saved-store trust.
- Missing, denied, or unreadable trust refuses the target without granting trust or falling back to approval. Remaining writes for a refused target stop; earlier writes can remain and must be reported without rollback, while later independent trusted targets may proceed. Cancellation likewise stops remaining writes and preserves earlier results. These are bounded prewrite checks, not atomic trust/write locking or a sandbox/security certification; they do not edit `.pi/settings.json`, install packages, or reload Pi.
- Saved loadouts are named groups of active package sources. `profile` is mostly the internal catalog term.
- `/construct save <name>` includes effectively Active Construct-managed package sources and offers effectively Active unloaded declarations for explicit loading/inclusion in TUI. It excludes disabled declarations, all-off partial-filter declarations, and all unresolved declarations with explicit summaries; unadopted unresolved/all-off rows remain read-only Unloaded. Both TUI and non-TUI save warn that direct project-local resources are not included. Non-TUI save may auto-load eligible active unloaded package declarations so scripted saves can complete.
- Saved loadouts and share snippets are package-source-only for now; adopted direct project-local resources are project-local toggle metadata only. Do not add portable direct-resource export/import without an explicit product decision.
- Saved loadouts do not serialize package child-resource filters. Use `pi config -l` for exact project resource overrides; reusable direct skills should become a conventional local/git/npm Pi package rather than a Construct-owned file-sync format.
- Saving over an existing loadout never appends or merges; TUI asks before replacing.
- `/construct run <saved-name>` applies the saved loadout once: ordinary whole-package-disabled declarations retain Enable behavior even with zero resolved resources, while undeclared remembered sources (including stale Construct metadata without a declaration) retain Install behavior. All-off partial-filter and unresolved declared packages are skipped with an explanation to inspect the declaration using `pi config -l`; run never clears partial filters to enable them. Projects are not live-linked to saved loadouts.
- Saved loadouts appear as compact `◆` rows in `/construct`; focusing one marks member package rows with `[·]`, Enter on a focused saved row runs it through the dashboard progress/result/reload flow, and Space on a saved row quick-selects its member package rows for normal package actions. Recipe summaries follow effective classification: all-off partial and unresolved declared members do not count active, and their saved-row runs skip with an explanation. Saved rows are recipe/spotlight rows only; project removal and dashboard unload stay on package rows.
- Dashboard Right Arrow on a package row unfolds package-contained resources inline using Pi's native resolver only when multiple resources are already known; Left Arrow folds, child state icons show current state (`✓` active, `–` inactive, `+` available), `[x]` selects a child for the next action, and parent Space cycles child selection presets all → active → inactive/available → none. Enter previews/writes native Pi package filters after backup/re-read safeguards: selected existing child resources are toggled, unselected existing children keep their current state, and selected Available children install/enable. Available package rows are cache-inspected without network/download during dashboard build and show the normal collapsed arrow only when multiple resources are already known; unknown Available rows with no cached multi-resource list have no hidden Right Arrow action. Single-resource and unknown Available packages stay whole-package rows. Resource-level selection writes an explicit allowlist across all package resource kinds so future package-added resources stay disabled until selected; whole-package row Enter is the path for trusting package defaults. `Ctrl+Alt+R` remains package-level project removal; package-contained child resources are filtered, not removed individually.
- A child-resource filter action mixed with any ordinary package, direct-resource, or saved-loadout row selection must refuse before mutation and direct the user to split actions. Parent aggregate selection within its own child group and multiple child-only package groups remain valid. Package resource filter plans and Agent Skill link plans also refuse when combined in one submit.
- Declared Git packages that expose zero native Pi package resources but contain Agent Skills in the managed checkout are skill carriers. Construct discovers valid skills with Pi's public `loadSkillsFromDir`, shows them as collapsed inline package child rows (Right Arrow unfolds, Left Arrow folds, and the parent row reports the available Agent Skill count; unlike ordinary package groups a carrier stays inspectable even with a single discovered skill because the child is the explicit link control), and writes selected skill roots into the project-level top-level `skills` array through `SettingsManager` after backup and re-read; it never patches `.pi/git` and never becomes a Git/package manager, and the package declaration remains so `pi update --extensions` owns the checkout. A package whose root itself contains `SKILL.md` uses `packageRelativeRoot` `.`. Classification: Active when any linked skill is enabled; Disabled otherwise (nothing linked yet or all linked paths off), with the parent description distinguishing those cases; Unresolved only when a declared package resolves zero native resources and no adapter/skills were discovered. The shared `withEffectivePackageStates` path maps an unlinked/discovered carrier to inactive (not unknown) and flags it, so save/run planning classifies a linked carrier Active and an unlinked one all-off while recipes stay source-only; run/save output for a discovered carrier points at `/construct` package children rather than `pi config -l`, and save summaries count carriers separately from generic all-off/partial filters. Available catalog rows use their bounded advisory catalog inventory (names, descriptions, and package-relative roots only, validated and capped) when present, so a previously inspected carrier keeps the same collapsed read-only children after its project checkout disappears. Without a snapshot, they can show read-only children from Pi's already-existing temporary cache; that cache-only, offline lookup never installs, fetches, scans another project, or persists data, and may be stale. Validated catalog snapshots win over cached inventories, and native Pi resources always win. An Available source with neither a snapshot nor suitable temporary cached inventory has no Agent Skills arrow. `/construct load` and successful dashboard carrier removal of an existing library item are the only snapshot writers (first installation alone does not record one; removal updates existing library entries only, load also refreshes an already-adopted carrier's inventory against existing library entries only, and an authoritative inspection that finds no adapter clears stale inventory). Selecting a linked skill unlinks its exact root, unselected linked skills keep state, and links loaded through a broader path or pattern refuse with a `pi config -l` pointer. Link removal also removes carrier-owned glob entries; a broader pattern that could cover other packages refuses package removal with a `pi config -l` reason instead of leaving it dangling, and every post-link-cleanup failure is reported as a partial runtime change with reload consent. A present-but-malformed `.claude-plugin/marketplace.json` yields a diagnostic and no adapter (a missing manifest still uses Pi-native discovery) so template skills are never published accidentally. `status full` summarizes found/linked/enabled per repository. Carrier-owned skills are never adopted by `/construct load` as independent direct resources (matched by the shared carrier-ownership helper, so genuinely independent direct skills still adopt), carrier removal prunes legacy duplicate direct skill metadata under the checkout while preserving unrelated metadata and files, and full status hides carrier-managed skills from the direct-resource section in favor of the Agent Skills repository summary.
- After waits or earlier operations, recheck each target's reviewed declaration policy and Pi-resolved resource list and enabled state, including additions as well as removals or state changes; a mismatch refuses and requires re-review. Recheck current-project trust through Pi before filtering. Preserve unselected state and unrelated settings, use existing source-matching helpers plus native settings backup/resolver paths, and add no whole-file hash, custom resolver/writer, lock, or CAS system. This is bounded stale-state validation, not atomic check-and-write or race elimination.
- Available install → re-resolve → filter is explicitly non-atomic: installation may remain when refreshed declaration policy/resources or trust prevent filtering. Report the partial outcome honestly and retain reload consent; if installation succeeds but filters do not, package defaults may remain enabled, so require re-review before reloading. Do not promise rollback.
- Known-project assignment counts and status-full missing-path notes are informational only. Keep counts out of dashboard rows for now; use status/unload contexts instead. They should help users understand cleanup/refactor impact, but unload should not block or hard-warn because it does not delete/disable resources from those projects. Do not prune known-project entries automatically.
- `/construct share <saved-name>` prints a small shareable JSON loadout snippet first. Clipboard can come later only through a safe/public path; do not depend on Pi internal clipboard helpers.
- `/construct wipe <saved-name>` removes only the saved loadout recipe; it never edits project files, disables/uninstalls packages, removes package sources from the Construct library, or reloads Pi.
- `/construct import <json>` validates and previews pasted snippets; TUI asks before writing, non-TUI previews only.

## Safety rules

- Do **not** edit live global Pi files unless explicitly requested:
  - `~/.pi/agent/auth.json`
  - `~/.pi/agent/settings.json`
  - `~/.pi/agent/npm/`
  - `~/.pi/agent/git/`
- Do not install the extension into live global Pi config unless explicitly requested.
- Prefer disposable fixture projects for testing project-local writes. A disposable `HOME` alone is not enough: clear inherited `PI_CODING_AGENT_DIR` and `PI_CODING_AGENT_SESSION_DIR`, and use `PI_OFFLINE=1`. Every smoke entrypoint must isolate itself, including when run outside `npm run smoke:all`.
- Before editing any `.pi/settings.json`, create a backup.
- Use the shared JSON write helper for Construct JSON writes; it writes via temp file and rename. Mutating flows should re-read relevant JSON state after idle waits or long-running package operations before merging/writing.
- Never write secrets, tokens, API keys, auth material, or generated package cache paths.
- Keep extra slash commands out unless clearly needed.

## Shipping protocol

When the user says “ship it,” treat that as a release request, not just a commit request.

Update all relevant release surfaces before tagging/publishing:

- package version in `package.json` and `package-lock.json`
- `CHANGELOG.md` release entry/date
- README for user-facing behavior changes, plus AGENTS/CHANGELOG as needed for tracked project context
- git commit on `main`
- git tag, pushed to origin
- GitHub Release for the shipped tag, marked latest when appropriate

Run the release validation before tagging or publishing:

```bash
npm run check
npm run smoke:all
npm run release:verify
npm publish --dry-run --access public
```

Do **not** assume npm publishing is complete just because git is tagged. If npm publish is needed, stop after dry-run and tell the user exactly when to run the npm command/2FA step, for example:

```bash
npm publish --access public
# or
npm publish --access public --otp=123456
```

After a human npm publish, verify with `npm view pi-construct version` and make sure GitHub’s latest release matches the shipped version.

## Validation

Run before release-sensitive changes:

```bash
npm run check
npm run smoke:all
npm run release:verify
```

Test extension loading and install/discovery only in an isolated environment, for example:

```bash
(
  ROOT="$PWD"
  TMP="$(mktemp -d)"
  trap 'rm -rf "$TMP"' EXIT
  unset PI_CODING_AGENT_DIR PI_CODING_AGENT_SESSION_DIR
  export HOME="$TMP/home" PI_OFFLINE=1
  mkdir -p "$HOME" "$TMP/project"
  cd "$TMP/project"
  pi --no-extensions -e "$ROOT" -p '/construct status'
  pi install "$ROOT" --approve
  pi -p '/construct status'
)
```

## Pi docs and local resources first

Use installed Pi docs before web search. Only go outside when local Pi docs/examples, repo files, and local `apricity/` notes do not answer the question, or when the user explicitly asks for outside research.

Start with:

- Main docs: `/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/README.md`
- Additional docs: `/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/docs/`
- Examples: `/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/examples/`

Key docs:

- Extensions: `/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/docs/extensions.md`
- Packages: `/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/docs/packages.md`
- Settings/project trust: `/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/docs/settings.md`
- Skills: `/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/docs/skills.md`
- Prompt templates: `/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/docs/prompt-templates.md`
- TUI/custom UI: `/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/docs/tui.md`

Relevant examples/implementations to review when coding:

- `project-trust.ts` for Pi trust behavior; Construct should not own trust decisions.
- `commands.ts` for slash command listing patterns.
- `tools.ts` for simple settings-list UI patterns.
- `dynamic-resources/index.ts` for future cwd/profile ideas, not current product behavior.
- `reload-runtime.ts` for safe reload behavior.
- Pi's native `pi config` implementation for package resource filtering behavior before building or changing Construct package-resource UI.

## Git/project hygiene

- Do not add generated package caches to this repo.
- Do not commit secrets.
- Keep plans/notes readable and low-tech.
