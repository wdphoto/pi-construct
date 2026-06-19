# Morning audit

Use this before adding features. The bias is one-menu, manual, explicit, and idiomatic Pi.

## First principles

- Are there any automatic paths that install, sync, enable, copy, update, reload, or mutate project files?
- Does every mutating path require explicit `/construct` interaction or explicit `/construct sync -a`?
- Are we relying on Pi primitives instead of rebuilding package management?
- Is `.pi/settings.json` still the source of truth and `.pi/construct.json` only advisory?
- Are we backing up `.pi/settings.json` before direct edits every time?
- Are we keeping global Pi config and live auth material untouched?

## Startup review

- Confirm there are no Construct `session_start`, `session_shutdown`, or `resources_discover` hooks that prompt, sync, install, reload, or write files.
- Confirm `/construct` opens the full loadout view even when `.pi/construct.json` is missing.
- Confirm read-only status does not create metadata.

## Command surface review

Active public surface should stay:

```text
/construct
/construct status
/construct sync
/construct sync -a
/construct sync status
/construct reload
```

If another command feels tempting, first ask whether it belongs inside the one `/construct` menu.

## Sync review

- Confirm `/construct sync` is the only path that adopts existing project package declarations outside the dashboard.
- Confirm sync does not install, remove, reload, copy, execute, or edit `.pi/settings.json`.
- Confirm invalid catalog/settings/metadata blocks writes safely.

## Dashboard review

- Is the dashboard too noisy?
- Can package rows be found quickly with search?
- Are runtime rows useful or flooding the view?
- Are local-only rows clearly explained?
- Does Space/Enter/Esc behavior feel safe?
- Are success/error summaries minimal and actionable?

## Project-state review

- Are writes scoped to `ctx.cwd` exactly as documented?
- Can `.pi/construct.json` drift from `.pi/settings.json` in ways that produce unsafe behavior?
- What happens if `.pi/settings.json` is invalid JSON?
- What happens if user catalog JSON is invalid?

## Test gaps

Covered:

- New-project `/construct` dashboard and read-only `/construct status` do not create `.pi/construct.json`.
- Manual sync adoption with `/construct sync -a`.
- Invalid user catalog, project settings, project construct metadata, and drift checks.
- Installed-package discovery with disposable `HOME`.

Still useful later:

- Real TUI keyboard pass for `/construct` and `/construct sync`.
- Local extension-file install smoke if Pi supports it.
- Git/npm source parsing tests without network where possible.

## Course-correction questions

- Should local-only rows be adoptable directly from the dashboard?
- Should runtime inventory be collapsed by default?
- Should doctor/conflict checks live in status or a future separate command?
- Is the no-startup-behavior rule still right?
