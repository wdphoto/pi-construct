# AGENTS.md

This repo is for **pi-construct** / **The Construct**, a global Pi extension / Pi package centered on `/construct`.

This is a Pi-native project. Before reaching for external web docs, use Pi's installed local documentation, local examples, and this repo's docs as the source of truth. Work smarter: verify against the APIs and behavior already on this machine.

## Project intent

- Build a friendly loadout manager for idiomatic Pi project-local config.
- Do not build a new package manager.
- The source of truth for project setup remains normal Pi files like `.pi/settings.json`, `.pi/prompts/`, `.pi/skills/`, `.pi/extensions/`, and project package declarations.
- Keep global Pi lean; the global extension provides commands, library/profile metadata, import/export, and onboarding only.

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

## Product model

Construct remembers Pi package source strings from project-local declarations and lets users arm/disarm projects from one loadout menu.

Keep versioning below `0.1.0` until the product is deliberately declared ready for `0.1.0`; `0.0.10`, `0.0.11`, etc. are acceptable.

Core loop:

1. Install a Pi package normally in a project:
   ```bash
   pi install <source> -l --approve
   ```
2. Run `/construct load` to add those project resources to the Construct library.
3. In another project, run `/construct` to enable/disable remembered resources.
4. After dashboard changes, press Enter on the final panel to reload Pi, or Esc to return and run `/reload` later.

Important files:

```text
.pi/settings.json                       # Pi project source of truth
.pi/construct.json                      # advisory Construct metadata
~/.pi/agent/construct/catalog.json      # user-local Construct library/profiles
~/.pi/agent/construct/settings.json     # user-local Construct settings
```

## Current command surface

Primary public command:

- `/construct`

Support commands:

- `/construct status`
- `/construct load`
- `/construct unload`
- `/construct autoload`
- `/construct profile list` (WIP)
- `/construct profile save <name>` (WIP)
- `/construct profile apply <name>` (WIP)

Use Pi's normal `/reload` after loadout changes. Do not advertise or re-add `/construct reload`; dashboard Enter can call `ctx.reload()` internally.

Do not re-add public `sync`, `toggle`, `library`, `remember`, `forget`, `catalog`, `enable`, `disable`, `remove`, `on`, `off`, `wipe`, or `reload` command paths without an explicit product decision.

## Behavior rules

- `/construct` opens the Construct Loadout dashboard.
- `/construct load` adds current project package declarations to the Construct library and advisory current-project metadata.
- `/construct unload` removes resources from the Construct library/profile refs/current-project metadata only.
- Unload never uninstalls packages, disables packages, reloads Pi, or edits `.pi/settings.json`.
- `.pi/settings.json` wins when it disagrees with `.pi/construct.json`.
- `.pi/construct.json` is advisory metadata only.
- `/construct status` is read-only and must not create `.pi/construct.json`.
- Autoload is off by default, quit-only, trusted-project/TUI-only, and always confirms before writing.
- Profiles exist but remain WIP in public docs.
- Known-project assignment counts are informational only. They should help users understand cleanup/refactor impact, but unload should not block or hard-warn because it does not delete/disable resources from those projects.
- `/construct copy` is a decided goal: print a small shareable JSON loadout snippet first. Clipboard can come later only through a safe/public path; do not depend on Pi internal clipboard helpers. Plan for a matching import flow with preview/confirmation.

## Safety rules

- Do **not** edit live global Pi files unless explicitly requested:
  - `~/.pi/agent/auth.json`
  - `~/.pi/agent/settings.json`
  - `~/.pi/agent/npm/`
  - `~/.pi/agent/git/`
- Do not install the extension into live global Pi config unless explicitly requested.
- Prefer disposable fixture projects for testing project-local writes.
- Before editing any `.pi/settings.json`, create a backup.
- Never write secrets, tokens, API keys, auth material, or generated package cache paths.
- Keep extra slash commands out unless clearly needed.

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

Relevant examples to review when coding:

- `project-trust.ts` for Pi trust behavior; Construct should not own trust decisions.
- `commands.ts` for slash command listing patterns.
- `tools.ts` for simple settings-list UI patterns.
- `dynamic-resources/index.ts` for future cwd/profile ideas, not current product behavior.
- `reload-runtime.ts` for safe reload behavior.

## Git/project hygiene

- Do not add generated package caches to this repo.
- Do not commit secrets.
- Keep plans/docs readable and low-tech.
