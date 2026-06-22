# Commands and UX

Construct is centered on one primary command: `/construct`.

## Public command surface

```text
/construct                         # one loadout menu / dashboard
/construct status                  # read-only diagnostics
/construct load [id-or-source ...] # add current project resources to the Construct
/construct unload [id-or-source ...] # remove resources from the Construct
/construct autoload                # optional exit prompt for loading new resources
/construct save <name>             # save active Construct resources as a named loadout
/construct saved                   # list saved loadouts
/construct run <saved-name>        # run a saved loadout in this project
/construct copy [saved-name]       # print a shareable saved-loadout JSON snippet
/construct import <json>           # preview/import a saved-loadout JSON snippet
```

Compatibility aliases remain available for now:

```text
/construct profile list
/construct profile save <name>
/construct profile apply <name>
```

No separate public toggle/library/catalog/reload command family for now. After dashboard changes, Construct offers Enter-to-reload using Pi's normal reload path; Esc cancels reload and returns to the session.

User-facing copy should prefer **library** over **catalog** except when naming the file path.

## `/construct load`

Load means adding existing project-level Pi package declarations to the Construct library and current-project Construct metadata.

- `/construct load` opens the picker in TUI mode with only unloaded/adoptable project package declarations.
- `/construct load` adds all currently loadable project package declarations in print mode.
- `/construct load <id-or-source ...>` directly loads matching unloaded/adoptable project package declarations.
- Load reads `.pi/settings.json` and can write:
  - `~/.pi/agent/construct/catalog.json`
  - `.pi/construct.json`
- Load never installs, removes, reloads, copies files, executes package code, or edits `.pi/settings.json`.
- Direct load arguments must already match project package declarations; use `pi install <source> -l --approve` or the dashboard Available section to add a package to the project first.

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

Saved loadouts are named groups of active Construct resources. `profile` remains the internal catalog word; user-facing copy should prefer saved loadout / saved.

```text
/construct save www
/construct saved
/construct run www
/construct copy www
/construct import '{"kind":"construct-loadout","version":1,"name":"www","sources":["npm:pkg"]}'
```

Save rules:

- `/construct save <name>` includes active Construct resources.
- Disabled resources are skipped.
- In TUI, active project resources not loaded into Construct are offered; selected rows are loaded into Construct and included, unselected rows are skipped.
- Saving over an existing name never appends or merges. TUI asks before replacing; non-TUI replacement refuses for now.

Run rules:

- `/construct run <saved-name>` applies the saved loadout once to the current project through the same conservative package-loading path used by the dashboard.
- Running a saved loadout is not a live binding; replacing the saved loadout later does not change projects that already ran it.
- `run` does not execute arbitrary scripts.

Copy/import rules:

- `/construct copy <saved-name>` prints a `kind: "construct-loadout"` JSON snippet for that saved loadout.
- `/construct copy` prints a snippet for the current active Construct resources.
- `/construct import <json>` validates and previews a pasted snippet.
- TUI import asks before writing; non-TUI import previews only and changes no files.
- Copy/import warns for local path sources because they are usually not portable across machines.
- Copy/import refuses generated Pi package cache paths and source strings that look like secrets.

Saved loadouts also appear as compact first-class rows in `/construct`; selecting one and pressing Enter runs it in the current project.

## `/construct`

In TUI mode, `/construct` is the place to see and change project loadout state.

Sections:

- `Saved` — named saved loadouts that can be run in this project.
- `Installed` — Construct-managed packages active in this project.
- `Disabled` — Construct-managed packages declared in this project with all package resource filters set to `[]`.
- `Available` — remembered packages that can be installed here.
- `Unloaded` — project package declarations that Construct has not loaded/adopted yet; use `/construct load` to adopt them.

Runtime skills/commands are not shown in the default dashboard. Use `/construct status` for runtime inventory counts and `/construct status full` for the longer diagnostic view.

Controls:

- type to search/filter;
- Space selects rows;
- row grammar separates selection from state: `[x]` means selected, while compact icons `◆`, `✓`, `–`, `+`, or `◇` describe current state; section headings carry the state words;
- keep rows compact; do not repeat `Active`, `Disabled`, `Available`, or `Unloaded` as a word column for every package;
- make the filter obvious with a label such as `Filter loadouts/packages:` and a hint that typing narrows by saved loadout/package/source/state;
- in TUI, use a quiet title line like `Loadout: 1 installed | 0 disabled | 3 available | 0 unloaded`;
- keep row text plain for readability; color only the compact state icon column: Saved accent, Installed/active clear green, Disabled muted green, Available warning/yellow, Unloaded muted gray;
- do not show trailing per-row action text; selected rows may be applied with Enter or removed with `r`, so end-of-row action hints are too wide and can be misleading;
- keep the state key short: `◇ unloaded`, not `read-only`; put commands on a separate controls line;
- Enter applies/runs the obvious action for selected rows: run `Saved`, install `Available`, disable `Installed`, or enable `Disabled`;
- Unloaded rows are not selectable in `/construct`; use `/construct load` to load/adopt them into Construct;
- `r` asks for confirmation, then removes selected `Installed` or `Disabled` package declarations from the project;
- Esc cancels without writing before apply;
- after apply, Enter reloads Pi when runtime-affecting settings changed;
- after apply, Esc cancels reload and returns to the session.

Keep hints subtle and summaries quiet. Success output should be verbose enough to show changed packages, then end with the Enter-to-reload / Esc-cancels-reload choice.
