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
3. Optionally run `/construct save <name>` to save the active Construct resource grouping.
4. In another project, run `/construct` or `/construct run <name>` to enable remembered resources.
5. After dashboard changes, press Enter on the final panel to reload Pi, or Esc to cancel reload and run `/reload` later.

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
- `/construct save <name>`
- `/construct saved`
- `/construct run <saved-name>`
- `/construct copy [saved-name]`
- `/construct import <json>`

Compatibility aliases:

- `/construct profile list`
- `/construct profile save <name>`
- `/construct profile apply <name>`

Use Pi's normal `/reload` after loadout changes. Do not advertise or re-add `/construct reload`; dashboard Enter can call `ctx.reload()` internally.

`/construct run <saved-name>` is the explicit product-approved command for applying a saved loadout. Do not use `/construct run` as a dashboard alias.

Do not re-add public `sync`, `toggle`, `library`, `remember`, `forget`, `catalog`, `enable`, `disable`, `remove`, `on`, `off`, `wipe`, or `reload` command paths without an explicit product decision.

## Behavior rules

- `/construct` opens the Construct Loadout dashboard.
- Dashboard TUI title stays quiet: `Loadout: N installed | N disabled | N available | N unloaded`.
- Dashboard row text stays plain; only the state icon column is colored: Saved is accent, Installed/active is clear green, Disabled is muted green, Available is yellow, Unloaded is gray; headings use the normal accent/heading color.
- `/construct load` adds current project package declarations to the Construct library and advisory current-project metadata.
- `/construct unload` removes resources from the Construct library/saved-loadout refs/current-project metadata only.
- Unload never uninstalls packages, disables packages, reloads Pi, or edits `.pi/settings.json`.
- `.pi/settings.json` wins when it disagrees with `.pi/construct.json`.
- `.pi/construct.json` is advisory metadata only.
- `/construct status` is read-only and must not create `.pi/construct.json`.
- Autoload is off by default, trusted-project/TUI-only, and always confirms before writing. It can prompt for new `.pi/settings.json` package declarations during a session and still scans on quit.
- Saved loadouts are named groups of active Construct resources. `profile` is mostly the internal catalog term.
- `/construct save <name>` includes active Construct resources, skips disabled resources, and in TUI offers active unloaded resources for optional loading/inclusion.
- Saving over an existing loadout never appends or merges; TUI asks before replacing.
- `/construct run <saved-name>` applies the saved loadout once. Projects are not live-linked to saved loadouts.
- Saved loadouts appear as compact `◆` rows in `/construct`; selecting one and pressing Enter runs it through the dashboard progress/result/reload flow.
- Known-project assignment counts are informational only. They should help users understand cleanup/refactor impact, but unload should not block or hard-warn because it does not delete/disable resources from those projects.
- `/construct copy [saved-name]` prints a small shareable JSON loadout snippet first. Clipboard can come later only through a safe/public path; do not depend on Pi internal clipboard helpers.
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
