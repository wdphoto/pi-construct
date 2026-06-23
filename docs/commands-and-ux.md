# Commands and UX

Construct is centered on one primary command: `/construct`.

## Public command surface

```text
/construct                         # one loadout menu / dashboard
/construct status                  # read-only diagnostics
/construct scan [path]             # find unloaded trusted local project resources
/construct load [id-or-source-or-path ...] # add current project resources to the Construct
/construct unload [id-or-source ...]         # remove resources from the Construct
/construct save <loadout-name>     # save active package sources as a named loadout
/construct list                    # list saved loadouts
/construct run <saved-name>        # run a saved loadout in this project
/construct share <saved-name>      # print a shareable saved-loadout JSON snippet
/construct wipe <saved-name>       # wipe a saved loadout recipe only
/construct import [json]           # paste/preview/import a saved-loadout JSON snippet
```

No separate public toggle/library/catalog/reload command family for now. After dashboard changes, Construct offers Enter-to-reload using Pi's normal reload path; Esc cancels reload and returns to the session.

User-facing copy should prefer **library** over **catalog** except when naming the file path.

## `/construct status`

Status is read-only. `/construct status` gives a compact current-project summary, and `/construct status full` gives diagnostics for JSON files, Construct library state, project package/direct-resource inventory, project package-contained resource inventory, native package filter state, and runtime command/tool inventory. Package-contained resources are reported so dashboard package-resource picking can stay Pi-native. Verbose status may also note known-project entries whose saved paths no longer exist; those notes are informational only and Construct does not prune the known-project index automatically.

## `/construct scan`

Scan finds unloaded resources in local project folders. Print mode is read-only; TUI mode can load selected findings into Construct.

- `/construct scan` reads Pi's trust store and scans trusted local paths that are not obviously broad/private roots.
- `/construct scan <path>` scans a specific local tree, useful for monorepos or project parent folders.
- It detects Pi projects by `.pi/settings.json`, `.pi/construct.json`, or project-local `.pi/extensions`, `.pi/skills`, `.pi/prompts`, and `.pi/themes` directories.
- It scans only projects trusted by Pi. Untrusted projects are skipped and listed.
- It reports package declarations missing from the Construct library or that project's `.pi/construct.json` metadata.
- It reports direct project-local resources not adopted into that project's `.pi/construct.json` metadata.
- It uses conservative file parsing instead of executing packages or running Pi resource resolution across projects.
- In the TUI, it shows lightweight progress while scanning and presents findings as a selectable checklist.
- Pressing Enter on selected scan findings loads them into Construct using the same write boundaries as `/construct load`.
- It skips noisy directories such as `node_modules`, `.git`, `.pi/npm`, `.pi/git`, `dist`, and `build`.
- It never installs packages, unloads, changes trust, reloads Pi, or edits `.pi/settings.json`.
- TUI loading writes only the user Construct library for packages and selected projects' `.pi/construct.json` metadata.
- Print-mode output ends with `No files were changed.`

Scan is intentionally project-local. It does not scan user/global skill locations such as `~/.pi/agent/skills`, `~/.agents/skills`, or generated Pi package caches.

## `/construct load`

Load means adding existing project-level Pi resources to Construct.

- `/construct load` opens the picker in TUI mode with unloaded/adoptable project package declarations and direct project resources.
- `/construct load` adds all currently loadable project resources in print mode.
- `/construct load <id-or-source-or-path ...>` directly loads matching unloaded/adoptable project resources.
- Package declarations are added to the user Construct library and current-project Construct metadata.
- Project-local direct resources are adopted into `.pi/construct.json` metadata only; they are not added to the portable library.
- Load reads `.pi/settings.json` plus Pi's native resolved resource inventory and can write:
  - `~/.pi/agent/construct/catalog.json` for package declarations only
  - `.pi/construct.json`
- Load never installs, removes, reloads, copies files, executes package code, or edits `.pi/settings.json`.
- Direct package load arguments must already match project package declarations; use `pi install <source> -l --approve` or the dashboard Available section to add a package to the project first.

## `/construct unload`

Unload means removing resources from the Construct library.

- `/construct unload` opens a picker in TUI mode.
- `/construct unload <id-or-source ...>` removes matching library resources directly.
- Unload removes matching entries from the user Construct library.
- Unload prunes matching entries from saved loadouts.
- Unload removes matching advisory metadata from the current project's `.pi/construct.json` when present.
- Unload never edits `.pi/settings.json` and never uninstalls a package from a project.
- Unload output should use “Construct forgot” style wording so it is clear the package itself was not disabled or removed.
- Unload may show “known projects” assignment counts from Construct's user-local project index. These counts are informational only and never block unload.
- Keep known-project counts out of dashboard rows for now; the dashboard should stay focused on current-project state/actions, while status/unload can carry broader informational counts.

If a project package declaration has not been loaded into Construct, it appears under `Unloaded` in the dashboard.

## Saved loadouts

Saved loadouts are named groups of active package sources. `profile` remains the internal catalog word; user-facing copy should prefer saved loadout / saved. Active unloaded package declarations are offered for explicit loading/inclusion when saving in TUI. Decision: saved loadouts and share snippets are package-source-only for now. Adopted direct project-local resources are intentionally excluded and stay project-local Construct metadata; save output should warn when direct resources are present.

```text
/construct save www
/construct list
/construct run www
/construct share www
/construct wipe www
/construct import '{"kind":"construct-loadout","version":1,"name":"www","sources":["npm:pkg"]}'
```

Save rules:

- `/construct save <loadout-name>` includes active Construct-managed package sources; TUI shows active unloaded package declarations as optional load/include rows before saving.
- Disabled package declarations are skipped.
- In TUI, active package declarations not loaded into Construct are offered; selected rows are loaded into Construct and included, unselected rows are skipped.
- Saving over an existing name never appends or merges. TUI asks before replacing; non-TUI replacement refuses for now.

Run rules:

- `/construct run <saved-name>` applies the saved loadout once to the current project through the same conservative package-loading path used by the dashboard.
- Running a saved loadout is activate-only: it installs available recipe package sources and enables disabled recipe package sources. It does not disable/remove active packages, remove packages outside the recipe, or exact-match the project to the recipe.
- Running a saved loadout is not a live binding; replacing the saved loadout later does not change projects that already ran it.
- `run` does not execute arbitrary scripts.

Share/import/wipe rules:

- `/construct share <saved-name>` prints a `kind: "construct-loadout"` JSON snippet for that saved loadout.
- Share prints to screen/output only in this slice; it is not clipboard or file export.
- `/construct import` opens a TUI paste box for JSON, then previews before writing.
- `/construct import <json>` validates and previews a pasted snippet; non-TUI import previews only and changes no files.
- Share/import warns for local path sources because they are usually not portable across machines.
- Share/import refuses generated Pi package cache paths and source strings that look like secrets.
- `/construct wipe <saved-name>` deletes only the saved loadout recipe. It does not edit project files, uninstall/disable packages, remove package sources from the Construct library, or reload Pi.

Saved loadouts also appear as compact first-class rows in `/construct`. They are recipe/spotlight rows: focusing one marks its member package rows with `[·]`, pressing Enter activates the saved loadout additively, and pressing Space quick-selects its member package rows for normal package actions. Disable/remove remains a package-row action, not a saved-loadout action.

## `/construct`

In TUI mode, `/construct` is the place to see and change project loadout state.

If the current project has no `.pi/construct.json` yet, `/construct` may show a quiet “no Construct metadata yet” hint. This is informational onboarding only and does not create metadata; `/construct load` remains the explicit adoption path.

Sections:

- `Loadouts` — named saved loadout recipes that can be run in this project.
- `Active` — Construct-managed resources active in this project.
- `Disabled` — Construct-managed resources present in this project but disabled by Pi package/direct resource filters.
- `Available` — remembered packages that can be installed here.
- `Unloaded` — project package declarations or direct project resources that Construct has not loaded/adopted yet; use `/construct load` to adopt them. Project-local direct resources are adopted into `.pi/construct.json` metadata only, not the portable library; after adoption, Enter toggles direct resources with Pi-native filters.

Runtime skills/commands are not shown in the default dashboard. Use `/construct status` for runtime inventory counts and `/construct status full` for the longer diagnostic view. The dashboard and status full now also report direct project resources discovered through Pi's native resolver: project extensions, skills, prompt templates, and themes.

Controls:

- type to search/filter;
- Space selects rows; on a loadout row, Space selects that recipe's selectable package rows instead of selecting the loadout row itself;
- row grammar separates selection from state: `[x]` means selected, `[·]` means included by the focused loadout recipe, `[!]` means read-only, while compact icons `◆`, `✓`, `–`, `+`, or `◇` describe current state; section headings carry the state words;
- Right Arrow on an installed package row unfolds package-contained resources inline using Pi's native resolver when the package has multiple resolved resources; Left Arrow folds. Space on child rows changes target enabled state, and Enter previews/writes native Pi package filters. `Available` package rows show the normal collapsed arrow before resource counts are known; Right Arrow inspects package-contained resources lazily, and if multiple resources exist, child selections start unchecked, install the package project-local first, and then immediately narrow it with native Pi package filters. Packages with zero or one resolved resource stay as whole-package rows and show no unfold affordance after inspection;
- keep rows compact; do not repeat `Active`, `Disabled`, `Available`, or `Unloaded` as a word column for every package;
- make the filter obvious with a compact line such as `Filter: all items · type to narrow`;
- in TUI, use a quiet title with the package/version string and a count line like `1 active | 0 disabled | 3 available | 0 unloaded`;
- color row content by state while keeping cursor/checkbox markers plain: Loadouts/Saved and Active heading accent, Disabled muted, Available warning/yellow, Unloaded/read-only muted gray; bold the focused row content;
- show compact package source labels in rows where possible, e.g. `github:owner/repo` or `local:<dir>`, while keeping exact source strings in saved metadata and write operations;
- do not show trailing per-row action text; selected rows may be applied with Enter or removed with `r`, so end-of-row action hints are too wide and can be misleading;
- keep the footer short and two-line: controls first, then `[!] read-only · [·] recipe item`;
- Enter applies/runs the obvious action for selected rows: install `Available`, disable `Active`, or enable `Disabled`; for packages this is a whole-package toggle, and for Construct-managed direct resources this writes top-level `+path` / `-path` filters;
- package disable/enable remains a whole-package toggle for unfiltered or whole-package-disabled packages. Construct now refuses this toggle when a package already has partial Pi package filters, rather than silently clobbering resource-level selections; package-row child selection is the native Pi-filter path for intentional partial changes;
- Enter on a focused saved loadout with no selected rows is activate-only: it installs available package sources and enables disabled package sources, but does not disable/remove active member packages, remove packages outside the recipe, or exact-match the project to the recipe;
- Unloaded rows are not selectable in `/construct`; use `/construct load` to load/adopt them into Construct;
- `r` asks for confirmation, then removes selected `Active` or `Disabled` package declarations from the project; saved loadout rows do not remove their member packages; package-contained child resources are filtered with Space/Enter rather than removed individually;
- Esc cancels without writing before apply;
- after apply, Enter reloads Pi when runtime-affecting settings changed;
- after apply, Esc cancels reload and returns to the session.

Keep hints subtle and summaries quiet. Success output should be verbose enough to show changed packages, then end with the Enter-to-reload / Esc-cancels-reload choice.
