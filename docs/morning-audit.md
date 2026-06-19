# Morning audit

Use this before adding more features. The bias is manual, explicit, and idiomatic Pi.

## First principles to verify

- Are there any remaining automatic paths that install, sync, enable, copy, update, reload, or mutate project files?
- Does every mutating command require an explicit user command or explicit TUI selection?
- Are we relying on Pi primitives instead of rebuilding package management?
- Is `.pi/settings.json` still the source of truth and `.pi/construct.json` only advisory?
- Are we backing up `.pi/settings.json` before direct edits every time?
- Are we keeping global Pi config and live auth material untouched?

## Startup review

- Confirm there are no Construct `session_start`, `session_shutdown`, or `resources_discover` hooks that prompt, sync, install, reload, or write files.
- Confirm `/construct` opens the full loadout view even when `.pi/construct.json` is missing.
- Confirm future onboarding automation remains roadmap-only and opt-in.

## Sync review

- Confirm `/construct sync` is the only path that adopts existing project package declarations.
- Confirm removed automation commands do not appear in help/completions.
- Does sync write project `.pi/construct.json` too aggressively when it only means “adopted,” not “installed by Construct”?
- Sync should ask even for a single package in TUI mode; `/construct sync -a` is the explicit adopt-all shortcut.

## Load/unload/toggle review

- Does `/construct load` make it clear that it will call `pi install <source> -l --approve`?
- Does checkbox UI avoid accidental installs from stale checked state?
- Do direct loads of ad-hoc sources ask before adding to the user library in all UI-capable modes?
- Does `/construct toggle` only affect Construct-managed packages and ignore local-only package declarations?
- Does unload/remove wording avoid implying local files or package caches are deleted?
- Are local path sources normalized consistently across load, unload, sync, and status?
- Are git and npm source identities deduped well enough for MVP, or is exact string matching too fragile?

## Project-state review

- Are writes scoped to `ctx.cwd` exactly as documented?
- Do we need git-root detection later, or is `ctx.cwd` still the right MVP rule?
- Can `.pi/construct.json` drift from `.pi/settings.json` in ways that produce unsafe behavior?
- Should `.pi/construct.json` record `managedReason: loaded|synced|accepted` to avoid conflating origins?
- What happens if `.pi/settings.json` is invalid JSON? Do all commands fail safely?
- What happens if user catalog JSON is invalid? Do commands avoid overwriting it?

## UI / command surface review

- Is `/construct` too powerful as a dashboard that can load/unload in one screen?
- Should load and unload be separate manual flows for now to reduce accidental toggles?
- Are hidden compatibility commands (`on`, `off`, `enable`, `disable`, `remove`) worth keeping?
- Should command help stop mentioning commands that are no-op or non-primary?
- Are notifications too ephemeral for important mutation summaries?
- In print/non-TUI mode, do commands avoid prompts and produce useful text?

## Pi package behavior review

- Pi itself auto-installs packages declared in trusted project `.pi/settings.json`. Is this explained clearly in README/docs?
- Does Construct ever silently add package declarations that would cause Pi to auto-install on next startup?
- Are local extension files accepted by `pi install` in the same way as package dirs, and have we tested that?
- Do npm packages with install scripts surface npm approval warnings clearly enough?
- Should Construct preflight warn before loading packages with native/install-script dependencies, or is that Pi/npm's job?

## Test gaps

Covered now:

- New-project `/construct` opens the full loadout view and `/construct status` remains read-only when `.pi/construct.json` is missing.
- No Construct lifecycle/autoload/autosync wiring remains in `extensions` or `scripts`.
- Invalid user catalog, project settings, project construct metadata, and drift checks are covered by `scripts/invalid-drift-smoke.sh`.
- Project A raw local package install -> `/construct sync -a` in print smoke / menu sync in TUI -> Project B load/unload/toggle is covered by `scripts/e2e-smoke.sh`.

Still useful later:

- Add a local extension-file install smoke if Pi supports it.
- Add git and npm source parsing/dry-run tests without network where possible.
- Add a true startup/no-output regression check if the harness gets a good way to observe session start without explicit commands.

## Course-correction questions

- Should Construct stop calling `pi install` directly and only edit `.pi/settings.json` declarations, leaving Pi to reconcile on reload? Or is native `pi install -l --approve` the more idiomatic explicit path?
- Is the no-startup-behavior rule still right, or is it time to design an explicit opt-in automation toggle?
- Should Construct avoid writing `.pi/construct.json` during `/construct sync` so sync remains purely user-library memory?
- Should we reduce the dashboard to read-only status plus explicit `load` / `unload` commands until safety feels boring?
- Should profiles/export be postponed completely until load/unload/sync have fewer edge cases?

## Morning order of operations

1. Read `docs/mvp.md` hard rules.
2. Sweep `extensions/construct/index.ts` for automatic behavior.
3. Sweep `extensions/construct/commands/sync.ts` for no background settings writes.
4. Sweep load/unload/toggle code for explicit confirmation, backups, and source matching.
5. Run the smoke suite with disposable HOME.
6. Update docs only after code behavior is verified.
