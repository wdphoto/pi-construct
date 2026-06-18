# Morning audit

Use this before adding more features. The bias is manual, explicit, and idiomatic Pi.

## First principles to verify

- Are there any remaining automatic paths that install, sync, enable, copy, update, reload, or mutate project files?
- Does every mutating command require an explicit user command or explicit TUI selection?
- Are we relying on Pi primitives instead of rebuilding package management?
- Is `.pi/settings.json` still the source of truth and `.pi/construct.json` only advisory?
- Are we backing up `.pi/settings.json` before direct edits every time?
- Are we keeping global Pi config and live auth material untouched?

## Autoload / startup review

- Does `maybeOfferAutoload` ask only after `ctx.isProjectTrusted()` and only in TUI mode?
- Does accepting the autoload prompt record user-local seen state so reload does not ask again?
- Does declining also record user-local seen state?
- Should `skips.json` be renamed/reworked into `projects.json` or `seen-projects.json`?
- Should there be a command to reset the seen marker for the current project?
- If the Construct library is empty, should autoload stay silent or offer onboarding?
- Does autoload open `/construct` rather than `/construct load`, so the user sees the full state first?

## Sync review

- Confirm `/construct sync` is the only path that adopts existing project package declarations.
- Confirm `/construct sync on|off` and `/construct autosync` do not change settings or enable background behavior.
- Should compatibility aliases be removed entirely instead of no-oping?
- Does sync write project `.pi/construct.json` too aggressively when it only means “adopted,” not “installed by Construct”?
- Should sync ask even for a single package, or is auto-adopting a single explicit `/construct sync` candidate acceptable?

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
- Are hidden compatibility commands (`on`, `off`, `enable`, `disable`, `remove`, `autosync`) worth keeping?
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

- Add a test that autoload prompt records seen state on accept and decline.
- Add a test that reload/startup does not re-offer once seen state exists.
- Add a test that `/construct sync on`, `/construct sync off`, and `/construct autosync on` do not enable background sync.
- Add a local extension-file install smoke if Pi supports it.
- Add git and npm source parsing/dry-run tests without network where possible.
- Add invalid JSON tests for user catalog, user settings, project settings, and project construct metadata.

## Course-correction questions

- Should Construct stop calling `pi install` directly and only edit `.pi/settings.json` declarations, leaving Pi to reconcile on reload? Or is native `pi install -l --approve` the more idiomatic explicit path?
- Should MVP remove background autoload entirely and require `/construct` manually, despite the desired onboarding prompt?
- Should Construct avoid writing `.pi/construct.json` during `/construct sync` so sync remains purely user-library memory?
- Should we reduce the dashboard to read-only status plus explicit `load` / `unload` commands until safety feels boring?
- Should profiles/export be postponed completely until load/unload/sync have fewer edge cases?

## Morning order of operations

1. Read `docs/mvp.md` hard rules.
2. Sweep `extensions/construct/index.ts` and `extensions/construct/lifecycle.ts` for automatic behavior.
3. Sweep `extensions/construct/commands/sync.ts` for no background or no-op settings writes.
4. Sweep load/unload/toggle code for explicit confirmation, backups, and source matching.
5. Run the smoke suite with disposable HOME.
6. Update docs only after code behavior is verified.
