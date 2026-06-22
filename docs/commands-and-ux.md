# Commands and UX

Construct is centered on one primary command: `/construct`.

## Public command surface

```text
/construct                         # one loadout menu / dashboard
/construct status                  # read-only diagnostics
/construct load [id-or-source-or-path ...] # add current project resources to the Construct
/construct unload [id-or-source ...]         # remove resources from the Construct
/construct autoload                # optional exit prompt for loading new resources
/construct save <name>             # save active Construct package sources as a named loadout
/construct list                    # list saved loadouts
/construct run <saved-name>        # run a saved loadout in this project
/construct share <saved-name>      # print a shareable saved-loadout JSON snippet
/construct remove <saved-name>     # remove a saved loadout recipe only
/construct import [json]           # paste/preview/import a saved-loadout JSON snippet
```

No separate public toggle/library/catalog/reload command family for now. After dashboard changes, Construct offers Enter-to-reload using Pi's normal reload path; Esc cancels reload and returns to the session.

User-facing copy should prefer **library** over **catalog** except when naming the file path.

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

If a project package declaration has not been loaded into Construct, it appears under `Unloaded` in the dashboard.

## `/construct autoload`

Autoload is off by default. When enabled, it watches for new project package declarations during the session and also checks on session quit. It always asks before loading anything into Construct.

```text
/construct autoload        # toggle on/off
/construct autoload on     # explicit on
/construct autoload off    # explicit off
/construct autoload status # show current state
```

Autoload rules:

- trusted projects only;
- TUI only;
- session-time `.pi/settings.json` changes are offered one by one after Pi is idle;
- quit/exit still scans for any remaining unloaded resources;
- always requires confirmation;
- never installs packages;
- never enables resources;
- never edits `.pi/settings.json`;
- only writes the Construct library and `.pi/construct.json` after confirmation.

## Saved loadouts

Saved loadouts are named groups of active Construct package sources. `profile` remains the internal catalog word; user-facing copy should prefer saved loadout / saved. Adopted direct project-local resources are intentionally excluded from saved loadouts and share snippets until a portable direct-resource format is designed.

```text
/construct save www
/construct list
/construct run www
/construct share www
/construct remove www
/construct import '{"kind":"construct-loadout","version":1,"name":"www","sources":["npm:pkg"]}'
```

Save rules:

- `/construct save <name>` includes active Construct package sources.
- Disabled package declarations are skipped.
- In TUI, active package declarations not loaded into Construct are offered; selected rows are loaded into Construct and included, unselected rows are skipped.
- Saving over an existing name never appends or merges. TUI asks before replacing; non-TUI replacement refuses for now.

Run rules:

- `/construct run <saved-name>` applies the saved loadout once to the current project through the same conservative package-loading path used by the dashboard.
- Running a saved loadout is activate-only: it installs available recipe package sources and enables disabled recipe package sources. It does not disable/remove active packages, remove packages outside the recipe, or exact-match the project to the recipe.
- Running a saved loadout is not a live binding; replacing the saved loadout later does not change projects that already ran it.
- `run` does not execute arbitrary scripts.

Share/import/remove rules:

- `/construct share <saved-name>` prints a `kind: "construct-loadout"` JSON snippet for that saved loadout.
- Share prints to screen/output only in this slice; it is not clipboard or file export.
- `/construct import` opens a TUI paste box for JSON, then previews before writing.
- `/construct import <json>` validates and previews a pasted snippet; non-TUI import previews only and changes no files.
- Share/import warns for local path sources because they are usually not portable across machines.
- Share/import refuses generated Pi package cache paths and source strings that look like secrets.
- `/construct remove <saved-name>` deletes only the saved loadout recipe. It does not edit project files, uninstall/disable packages, remove package sources from the Construct library, or reload Pi.

Saved loadouts also appear as compact first-class rows in `/construct`. They are recipe/spotlight rows: focusing one marks its member package rows with `[·]`, pressing Enter activates the saved loadout additively, and pressing Space quick-selects its member package rows for normal package actions. Disable/remove remains a package-row action, not a saved-loadout action.

## `/construct`

In TUI mode, `/construct` is the place to see and change project loadout state.

Sections:

- `Saved` — named saved loadouts that can be run in this project.
- `Active` — Construct-managed resources active in this project.
- `Disabled` — Construct-managed resources present in this project but disabled by Pi package/direct resource filters.
- `Available` — remembered packages that can be installed here.
- `Unloaded` — project package declarations or direct project resources that Construct has not loaded/adopted yet; use `/construct load` to adopt them. Project-local direct resources are adopted into `.pi/construct.json` metadata only, not the portable library; after adoption, Enter toggles direct resources with Pi-native filters.

Runtime skills/commands are not shown in the default dashboard. Use `/construct status` for runtime inventory counts and `/construct status full` for the longer diagnostic view. The dashboard and status full now also report direct project resources discovered through Pi's native resolver: project extensions, skills, prompt templates, and themes.

Controls:

- type to search/filter;
- Space selects rows; on a saved loadout row, Space selects that recipe's selectable member package rows instead of selecting the saved row itself;
- row grammar separates selection from state: `[x]` means selected, `[·]` means included by the focused saved loadout, while compact icons `◆`, `✓`, `–`, `+`, or `◇` describe current state; section headings carry the state words;
- keep rows compact; do not repeat `Active`, `Disabled`, `Available`, or `Unloaded` as a word column for every package;
- make the filter obvious with a label such as `Filter loadouts/resources:` and a hint that typing narrows by saved loadout/package/resource/source/state;
- in TUI, use a quiet title line like `Loadout: 1 active | 0 disabled | 3 available | 0 unloaded`;
- keep row text plain for readability; color only the compact state icon column: Saved accent, Active clear green, Disabled muted green, Available warning/yellow, Unloaded muted gray;
- do not show trailing per-row action text; selected rows may be applied with Enter or removed with `r`, so end-of-row action hints are too wide and can be misleading;
- keep the state key short: `◇ unloaded`, not `read-only`; put commands on a separate controls line;
- Enter applies/runs the obvious action for selected rows: install `Available`, disable `Active`, or enable `Disabled`; for Construct-managed direct resources this writes top-level `+path` / `-path` filters;
- Enter on a focused saved loadout with no selected rows is activate-only: it installs available package sources and enables disabled package sources, but does not disable/remove active member packages, remove packages outside the recipe, or exact-match the project to the recipe;
- Unloaded rows are not selectable in `/construct`; use `/construct load` to load/adopt them into Construct;
- `r` asks for confirmation, then removes selected `Active` or `Disabled` package declarations from the project; saved loadout rows do not remove their member packages;
- Esc cancels without writing before apply;
- after apply, Enter reloads Pi when runtime-affecting settings changed;
- after apply, Esc cancels reload and returns to the session.

Keep hints subtle and summaries quiet. Success output should be verbose enough to show changed packages, then end with the Enter-to-reload / Esc-cancels-reload choice.
