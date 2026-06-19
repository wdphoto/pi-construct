# Commands and UX

Construct is still centered on one primary command: `/construct`.

## Public command surface

```text
/construct             # one loadout menu / dashboard
/construct status      # read-only diagnostics, including sync state
/construct sync        # choose current project packages to remember
/construct sync auto   # remember all new current project packages
/construct sync off    # explain that automatic sync is off
/construct profile list
/construct profile save <name>
/construct profile apply <name>
```

No separate public load/unload/toggle/library/catalog/reload command family for now. After dashboard changes, Construct offers Enter-to-reload using Pi's normal reload path; Esc returns to the session without reloading.

## `/construct sync`

Sync means manual adoption of existing Pi package declarations.

- `/construct sync` opens the adoption menu in TUI mode.
- `/construct sync auto` adopts every available current-project package declaration without a menu.
- `/construct sync on` is an alias for `/construct sync`.
- `/construct sync off` is a harmless explanation: automatic sync is off.
- Sync status belongs in `/construct status`, not a separate `sync status` subcommand.

Sync reads `.pi/settings.json` and can write:

- `~/.pi/agent/construct/catalog.json`
- `.pi/construct.json`

Sync never installs, removes, reloads, copies files, executes package code, or edits `.pi/settings.json`.

## Profiles

Profiles are named groups of Construct library packages.

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

- `Enabled` — Construct-managed packages active in this project.
- `Available` — remembered packages that can be enabled here.
- `Project-only` — active project package declarations that Construct has not adopted yet; read-only in the dashboard.

Runtime skills/commands are not shown in the default dashboard. Use `/construct status` for runtime inventory counts and diagnostics.

Controls:

- type to search/filter;
- Space toggles enabled package rows;
- Enter applies selected package diffs;
- Esc cancels without writing before apply;
- after apply, Enter reloads Pi when at least one change succeeded;
- after apply, Esc returns to the session without reloading.

Keep hints subtle and summaries quiet. Success output should be verbose enough to show changed packages, then end with the Enter-to-reload / Esc-to-return choice.
