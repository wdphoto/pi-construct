# Morning audit

Use this before adding features. The bias is one-menu, manual, explicit, and idiomatic Pi.

## First principles

- Are there any automatic paths that install, sync, enable, copy, update, reload, or mutate project files?
- Does every mutating path require explicit `/construct`, `/construct sync auto`, or `/construct profile apply` interaction?
- Are we relying on Pi primitives instead of rebuilding package management?
- Is `.pi/settings.json` still the source of truth and `.pi/construct.json` only advisory?
- Are we backing up `.pi/settings.json` before direct edits every time?
- Are we keeping global Pi config and live auth material untouched?

## Command surface review

Active public surface should stay:

```text
/construct
/construct status
/construct sync
/construct sync auto
/construct sync off
/construct profile list
/construct profile save <name>
/construct profile apply <name>
/construct reload
```

If another command feels tempting, first ask whether it belongs inside the one `/construct` menu.

## Sync review

- Confirm `/construct sync` is the only menu path that adopts existing project package declarations outside the dashboard.
- Confirm `/construct sync auto` is the explicit adopt-all shortcut.
- Confirm sync status is explained by `/construct status`.
- Confirm sync does not install, remove, reload, copy, execute, or edit `.pi/settings.json`.
- Confirm invalid catalog/settings/metadata blocks writes safely.

## Profile review

- Do profiles contain only library ids/sources?
- Does profile apply remain explicit?
- Does profile apply reuse the same package-loading path as the dashboard?
- Would this be better as a first-class dashboard row instead of another command?

## Dashboard review

- Is the dashboard too noisy?
- Can package rows be found quickly with search?
- Are runtime rows useful or flooding the view?
- Are local-only rows clearly explained?
- Does Space/Enter/Esc behavior feel safe?
- Are success/error summaries minimal and actionable?

## Test gaps

Covered:

- New-project `/construct` dashboard and read-only `/construct status` do not create `.pi/construct.json`.
- Manual sync adoption with `/construct sync auto`.
- Basic profile save/list/apply.
- Invalid user catalog, project settings, project construct metadata, and drift checks.
- Installed-package discovery with disposable `HOME`.

Still useful later:

- Real TUI keyboard pass for `/construct` and `/construct sync`.
- TUI profile/group interaction once profiles move into the dashboard.
- Local extension-file install smoke if Pi supports it.
