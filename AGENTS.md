# AGENTS.md

This repo is for **pi-construct** / **The Construct**, a global Pi extension / Pi package centered on `/construct`.

This is a Pi-native project. Before reaching for external web docs, use Pi's installed local documentation, local examples, and this repo's docs as the source of truth. Work smarter: verify against the APIs and behavior already on this machine.

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

- `AGENTS.md` — agent operating rules and compact build context.
- `MAP.md` — decided roadmap/action list, grouped by target version; this is the actual plan of record for upcoming work.
- `TODO.md` — scratchpad for research notes and undecided ideas; do not treat it as the committed roadmap.
- `README.md` — short human user guide.
- `HANDOFF.md` — current session/release handoff notes.
- `docs/` — architecture, product model, safety notes, command UX, and preflight checks.

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

## Product model

Construct remembers Pi package source strings from project-local declarations and lets users arm/disarm projects from one loadout menu.

Keep versioning below `0.1.0` until the product is deliberately declared ready for `0.1.0`; `0.0.10`, `0.0.11`, etc. are acceptable.

Core loop:

1. Install a Pi package normally in a project:
   ```bash
   pi install <source> -l --approve
   ```
2. Run `/construct load` to add package declarations to the Construct library and adopt direct resources into project metadata.
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
- `/construct unload`
- `/construct save <name>`
- `/construct list`
- `/construct run <saved-name>`
- `/construct share <saved-name>`
- `/construct wipe <saved-name>`
- `/construct import [json]`

Use Pi's normal `/reload` after loadout changes. Do not advertise or re-add `/construct reload`; dashboard Enter can call `ctx.reload()` internally.

`/construct run <saved-name>` is the explicit product-approved command for applying a saved loadout. Do not use `/construct run` as a dashboard alias.

Do not re-add public `sync`, `toggle`, `library`, `remember`, `forget`, `catalog`, `enable`, `disable`, `on`, `off`, `remove`, or `reload` command paths without an explicit product decision. `/construct scan [path]` is approved as a trusted local project report; no-arg scan may read Pi's trust store but must refuse broad/private roots, and TUI scan may load selected findings into Construct using `/construct load` write boundaries. `/construct wipe <saved-name>` is approved only for deleting saved loadout recipes, not project resources.

## Behavior rules

- `/construct` opens the Construct Loadout dashboard.
- Dashboard TUI title stays quiet and includes the package/version string plus counts.
- Dashboard row content is color-coded by state while cursor/checkbox markers stay plain: Loadouts/Saved and Active use the heading accent, Disabled is muted, Available is yellow, Unloaded/read-only is gray; focused row content may be bold; headings use the normal accent/heading color.
- `/construct load` adds current project package declarations to the Construct library and advisory current-project metadata; direct project resources are adopted into advisory current-project metadata only.
- `/construct unload` removes resources from the Construct library/saved-loadout refs/current-project metadata only.
- Unload never uninstalls packages, disables packages, reloads Pi, or edits `.pi/settings.json`.
- `.pi/settings.json` wins when it disagrees with `.pi/construct.json`.
- `/construct status full` and `/construct` report direct project resources using Pi's native resolver; `/construct load` can adopt them into project metadata, and dashboard Enter toggles adopted direct resources with Pi-native `+path` / `-path` filters.
- Package enable/disable is whole-package only for now for unfiltered or whole-package-disabled package declarations: disabling writes empty package resource filter arrays, enabling clears those all-empty filters. If a package already has partial Pi package filters, Construct must not silently clobber them; route users toward package resource picking instead.
- `.pi/construct.json` is advisory metadata only.
- `/construct status` is read-only and must not create `.pi/construct.json`; print-mode `/construct scan` is read-only, while TUI `/construct scan` may create/update `.pi/construct.json` only when the user selects findings and presses Enter to load them.
- Saved loadouts are named groups of active package sources. `profile` is mostly the internal catalog term.
- `/construct save <name>` includes active Construct-managed package sources, offers active unloaded package declarations for explicit loading/inclusion in TUI, skips disabled package declarations, and warns that direct project-local resources are not included. Non-TUI save may auto-load active unloaded package declarations so scripted saves can complete.
- Saved loadouts and share snippets are package-source-only for now; adopted direct project-local resources are project-local toggle metadata only. Do not add portable direct-resource export/import without an explicit product decision.
- Saving over an existing loadout never appends or merges; TUI asks before replacing.
- `/construct run <saved-name>` applies the saved loadout once. Projects are not live-linked to saved loadouts.
- Saved loadouts appear as compact `◆` rows in `/construct`; focusing one marks member package rows with `[·]`, Enter on a focused saved row runs it through the dashboard progress/result/reload flow, and Space on a saved row quick-selects its member package rows for normal package actions. Saved rows are recipe/spotlight rows only; disable/remove stays on package rows.
- Dashboard Right Arrow on a package row unfolds package-contained resources inline using Pi's native resolver only when multiple resources are available; Left Arrow folds, Space on child rows changes target enabled state, Enter previews/writes native Pi package filters after backup/re-read safeguards, and `i` opens details. For Available package rows, resource inspection is lazy on unfold; child selection starts unchecked, installs the remembered package project-local first, and then writes native Pi package filters. Packages with zero or one resolved resource remain whole-package rows. `r` remains package-level project removal; package-contained child resources are filtered, not removed individually.
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
- Prefer disposable fixture projects for testing project-local writes.
- Before editing any `.pi/settings.json`, create a backup.
- Use the shared JSON write helper for Construct JSON writes; it writes via temp file and rename. Mutating flows should re-read relevant JSON state after idle waits or long-running package operations before merging/writing.
- Never write secrets, tokens, API keys, auth material, or generated package cache paths.
- Keep extra slash commands out unless clearly needed.

## Shipping protocol

When the user says “ship it,” treat that as a release request, not just a commit request.

Update all relevant release surfaces before tagging/publishing:

- package version in `package.json` and `package-lock.json`
- `CHANGELOG.md` release entry/date
- README and docs for any user-facing behavior changes
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

Test extension loading explicitly:

```bash
pi --no-extensions -e .
```

Test install/discovery only with a disposable `HOME`, for example:

```bash
TMP="$(mktemp -d)"
mkdir -p "$TMP/home" "$TMP/project"
HOME="$TMP/home" pi install "$PWD" --approve
(cd "$TMP/project" && HOME="$TMP/home" pi -p '/construct status')
```

## Pi docs and local resources first

Use installed Pi docs before web search. Only go outside when local docs/examples and repo files do not answer the question, or when the user explicitly asks for outside research.

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
- Keep plans/docs readable and low-tech.
