# Commands and UX

Construct is centered on one primary command: `/construct`.

## Public command surface

```text
/construct             # one loadout menu / dashboard
/construct status      # read-only diagnostics
/construct load [id-or-source ...]    # add current project resources to the Construct
/construct unload [id-or-source ...]  # remove resources from the Construct
/construct autoload    # toggle exit prompt for loading new resources
/construct profile list          # WIP, not public yet
/construct profile save <name>   # WIP, not public yet
/construct profile apply <name>  # WIP, not public yet
```

No separate public toggle/library/catalog/reload command family for now. After dashboard changes, Construct offers Enter-to-reload using Pi's normal reload path; Esc returns to the session without reloading.

## `/construct load`

Load means adding existing project-level Pi package declarations to the Construct.

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
- Unload prunes matching entries from saved profiles.
- Unload removes matching advisory metadata from the current project's `.pi/construct.json` when present.
- Unload never edits `.pi/settings.json` and never uninstalls a package from a project.
- Unload output should use “Construct forgot” style wording so it is clear the package itself was not disabled or removed.
- Unload may show “known projects” assignment counts from Construct's user-local project index. These counts are informational only and never block unload.

If a project package declaration has not been loaded into Construct, it appears under `Unloaded` in the dashboard.

## `/construct autoload`

Autoload is off by default. When enabled, it runs only on session quit and always asks before loading anything.

```text
/construct autoload        # toggle on/off
/construct autoload on     # explicit on
/construct autoload off    # explicit off
/construct autoload status # show current state
```

Autoload rules:

- trusted projects only;
- TUI only;
- quit/exit only, not reload or session switching;
- always requires confirmation;
- never installs packages;
- never edits `.pi/settings.json`;
- only writes the Construct library and `.pi/construct.json` after confirmation.

## Profiles

Profiles are WIP named groups of Construct library packages.

```text
/construct profile save www
/construct profile apply www
/construct profile list
```

A profile is a one-stop stack like `www`, `golang`, or `pi-projects`. It stores library item ids and package sources, not copied package code. Applying a profile turns on the saved package sources for the current project through the same conservative package-loading path used by the dashboard.

Future polish: make profiles first-class rows in the `/construct` menu so applying a stack takes fewer clicks without adding much command noise.

## `/construct`

In TUI mode, `/construct` is the place to see and change project loadout state.

Sections:

- `Installed` — Construct-managed packages active in this project.
- `Disabled` — Construct-managed packages declared in this project with all package resource filters set to `[]`.
- `Available` — remembered packages that can be installed here.
- `Unloaded` — read-only project package declarations that Construct has not loaded/adopted yet; use `/construct load` to adopt them.

Runtime skills/commands are not shown in the default dashboard. Use `/construct status` for runtime inventory counts and `/construct status full` for the longer diagnostic view.

Controls:

- type to search/filter;
- Space selects rows;
- Enter applies the obvious state change for actionable rows: install `Available`, disable `Installed`, or enable `Disabled`;
- Unloaded rows are read-only in `/construct`; use `/construct load` to load/adopt them into Construct;
- `r` asks for confirmation, then removes selected `Installed` or `Disabled` package declarations from the project;
- Esc cancels without writing before apply;
- after apply, Enter reloads Pi when runtime-affecting settings changed;
- after apply, Esc returns to the session without reloading.

Keep hints subtle and summaries quiet. Success output should be verbose enough to show changed packages, then end with the Enter-to-reload / Esc-to-return choice.
