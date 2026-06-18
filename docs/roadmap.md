# Roadmap and future work

<!-- Source: the-construct-plan.md lines 678-780: Post-MVP profiles/templates -->

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

<!-- Source: the-construct-plan.md lines 1214-1387: Implementation status -->

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

Current checkpoint completed:

- [x] Package-root extension layout: `extensions/construct/index.ts` loaded via `pi --no-extensions -e .`.
- [x] `/construct` opens the main searchable dashboard/loadout view.
- [x] `/construct load [source-or-id]` runs `pi install <source> -l --approve` and records advisory `.pi/construct.json` metadata.
- [x] `/construct unload [source-or-id]` runs `pi remove <source> -l --approve`, marks Construct metadata unloaded, does not delete source files, and does not forget library items.
- [x] `/construct sync` adopts unsynced current-project package sources into `~/.pi/agent/construct/catalog.json` and `.pi/construct.json` with clean output.
- [x] Automatic/invisible sync is disabled for MVP; `/construct sync` is manual and `/construct sync status` reports that state.
- [x] Local path sources are normalized for cross-project library memory.
- [x] Unloaded Construct-managed items remain reloadable by id even without a global library entry.
- [x] Old `enable`/`disable`/`remove`/`autosync` verbs remain compatibility/power-user paths but are no longer the primary MVP surface.
- [x] `/construct library`, `/construct remember`, and `/construct forget` are the public library verbs; `/construct catalog` remains a compatibility alias.
- [x] `npm run check`, `./scripts/e2e-smoke.sh`, `./scripts/smoke.sh`, and `./scripts/install-smoke.sh` pass.

Next refactor order when we come back:

1. **Command audit and stale wording cleanup**
   - Audit the public surface in a disposable `HOME` and project: `/construct`, `status`, `load`, `unload`, `toggle`, `sync`, `sync status`, `library`, `remember`, `forget`, and `reload`.
   - Audit compatibility/debug paths: `catalog`, `catalog add`, `catalog remove`, `on`, `off`, `wipe`, `autoload`, `autosync`, and old `enable`/`disable`/`remove`.
   - Search output/docs/code for stale public wording: prefer `library`, `remember`, `forget`, `toggle`, `loadout`, `Construct-managed`, `local-only`, and `adopted`; avoid public `catalog` and `wipe` except compatibility notes.
   - Keep `catalog.json` as the on-disk schema/file name for now; the user-facing language is library.

2. **Save-based picker/menu flow**
   - [x] `/construct load` lists only loadable/unchecked remembered sources. User selects one or more with Space, hits Enter/Save, and Construct installs them with no second confirmation page.
   - [x] `/construct unload` lists only loaded Construct-managed declarations. User unchecks one or more with Space, hits Enter/Save, and Construct disables them with no second confirmation page.
   - [x] `/construct` is now the all-up loadout view: checked means loaded here, unchecked means available, warning means unsynced local-only and read-only. Save reconciles Construct package selections to `.pi/settings.json`.
   - [x] Remove the public `wipe` surface in favor of `/construct toggle`; hidden `/construct off` and `/construct on` aliases remain for testing. Toggle only touches Construct-managed items and ignores unsynced local-only Pi packages.
   - Esc/cancel bails. Save does the deed. Success output should be a short notification with `/construct reload` / `/reload` guidance.
   - Keep print/non-UI mode deterministic through explicit commands like `/construct load <source-or-id>` and `/construct unload <source-or-id>`.

3. **Decisions from the TUI pass**
   - Adoption stays in `/construct sync`, not a one-key dashboard action. If there is one unsynced item, sync adopts it immediately; if there are multiple, sync shows the same searchable save-based checkbox flow.
   - Runtime skill/command rows should be included in the dashboard and searchable. They are read-only inventory for now; package-backed resource filters can come later only if needed.
   - Direct `/construct load <ad-hoc-source>` does not need automatic remembering beyond the existing explicit behavior.
   - How much `pi install` / `pi remove` stdout should success notifications show after multi-select saves? Current direction is concise success, detailed output only on errors.

4. **Pretty listings**
   - Clean up status, sync, catalog/library, load, unload, toggle, and dashboard output.
   - Prefer concise sections, stable ordering, aligned labels where useful, and clear loaded/available/disabled language.
   - Keep verbose command stdout/stderr available only when useful for errors or diagnostics.

5. **Manual interactive TUI test**
   - Verify fuzzy search typing, Backspace, Space, Enter, Esc, and readable section headers in `/construct`, `/construct load`, `/construct unload`, and multi-item `/construct sync`.

6. **Restore/profile model**
   - Today, the project remembers actual loaded packages in `.pi/settings.json` and advisory Construct state in `.pi/construct.json`; there is no named profile command yet.
   - After `/construct toggle` turns a loadout off, Construct metadata should remain so previously managed items can be loaded again from the picker or by id.
   - `/construct toggle` is the simple current-project restore/rearm command before named profiles.
   - A profile should be a list of remembered source ids/sources plus any Pi package filters, not a new package format.
   - Consider making toggle-off save a `lastLoadout` snapshot before disabling everything, so restore is obvious even if metadata drifts.
   - Avoid resource-level filters unless we explicitly need partial package disable behavior.

<!-- Source: the-construct-plan.md lines 1513-1733: Exporting and sharing profiles -->

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

<!-- Source: the-construct-plan.md lines 1734-1765: Open questions and initial decisions -->

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

