# FAQ

Troubleshooting notes for Construct edge cases. This is not the basic command guide; see `README.md` for normal usage.

## What does “drift” mean?

Drift means Construct's advisory project metadata disagrees with Pi's actual project config.

Pi's project source of truth is:

```text
.pi/settings.json
```

Construct's project-local advisory metadata is:

```text
.pi/construct.json
```

If those files disagree, Construct reports drift in `/construct status`, `/construct scan`, or the dashboard.

Common examples:

```text
enabled in Construct metadata, missing from .pi/settings.json
```

Construct thinks the package is enabled for this project, but Pi no longer has a matching package declaration.

```text
disabled in Construct metadata, missing from .pi/settings.json
```

Construct remembers a disabled project package, but Pi no longer declares that package at all. This is stale Construct metadata.

```text
enabled in Construct metadata, disabled by package filters
```

Construct metadata says enabled, but Pi package filters disable the package's resources.

```text
disabled in Construct metadata, still active in .pi/settings.json
```

Construct metadata says disabled, but Pi has the package active.

## How can drift happen?

Drift can happen whenever `.pi/settings.json` changes without a matching update to `.pi/construct.json`.

Common causes:

- running `pi remove` outside Construct;
- manually editing `.pi/settings.json`;
- switching git branches with different `.pi/` files;
- restoring an old `.pi/settings.json` backup;
- older Construct behavior that removed package declarations but left disabled metadata behind;
- interrupted writes or metadata-only failures after a package operation.

Construct should avoid creating drift during normal dashboard operations. In current behavior:

- disabling a package keeps the package declaration and marks Construct metadata disabled;
- removing a package from the project removes the package declaration and matching project Construct metadata;
- wiping a saved recipe uses `/construct wipe <name>` and does not touch project files.

## What does scan “reconcile” do?

In TUI mode, `/construct scan` can select findings and press Enter to reconcile them.

Reconcile means: apply the safe metadata action for the selected scan rows.

For unloaded package declarations:

- adds the package source to the Construct library if needed;
- adds/updates current-project Construct metadata;
- does **not** edit `.pi/settings.json`.

For direct project resources such as `.pi/skills/`, `.pi/prompts/`, `.pi/themes/`, and `.pi/extensions/`:

- adopts selected resources into `.pi/construct.json` metadata;
- does **not** copy, install, delete, or move resource files;
- does **not** edit `.pi/settings.json`.

For drifted package metadata:

- if the package is active in `.pi/settings.json` but Construct metadata says disabled, reconcile re-arms Construct metadata;
- if Pi filters disable the package but Construct metadata says enabled, reconcile marks Construct metadata disabled;
- if the package is missing from `.pi/settings.json`, reconcile removes stale project Construct metadata;
- reconcile does **not** reinstall missing packages and does **not** edit `.pi/settings.json`.

Print-mode `/construct scan` is always read-only and ends with:

```text
No files were changed.
```

## Why does scan not reinstall drifted packages?

Because missing-from-settings drift means Pi no longer declares the package in the project.

Construct treats `.pi/settings.json` as the source of truth. Scan reconciliation is allowed to clean Construct metadata, but it is not allowed to silently put package declarations back into `.pi/settings.json`.

If you want a missing package active again, use the dashboard `Available` row or Pi directly:

```text
/construct
```

or:

```bash
pi install <source> -l --approve
```

Then run:

```text
/construct load
```

if the package needs to be adopted into Construct metadata.

## What is the difference between disable, remove, unload, and wipe?

These words are intentionally separate.

### Disable

Dashboard Enter on an `Active` package disables that package's resources through Pi filters.

It edits `.pi/settings.json` after creating a backup and updates Construct metadata to disabled.

The package declaration remains in the project.

### Remove from project

Dashboard `r` removes selected `Active` or `Disabled` package declarations from the current project.

It runs project-local `pi remove` where possible, backs up and edits `.pi/settings.json`, and removes matching project Construct metadata so stale drift is not left behind.

It does not delete global Pi package caches and does not delete saved recipes.

### Unload

`/construct unload <source>` makes Construct forget a resource from the user-local Construct library and saved-loadout references.

It does not edit `.pi/settings.json` and does not uninstall or disable project packages.

### Wipe

`/construct wipe <saved-name>` deletes only a saved loadout recipe.

It does not edit project files, uninstall packages, disable resources, remove package sources from the Construct library, or reload Pi.

There is no public `/construct remove <saved-name>` command. “Remove” now refers to dashboard project package removal only.

## How do I safely clean stale drift?

Use TUI scan:

```text
/construct scan
```

Then:

1. select drift rows with Space;
2. press Enter to reconcile;
3. verify with print scan:

```text
/construct scan
```

For missing-from-settings drift, this removes stale `.pi/construct.json` metadata and leaves `.pi/settings.json` alone.

## How do I restore a package that shows as drifted/missing?

If scan says a package is missing from `.pi/settings.json`, reconcile will clean metadata rather than reinstall it.

To restore the package:

1. install/activate it again with the dashboard Available row or `pi install <source> -l --approve`;
2. run `/construct load` if needed;
3. run `/construct status` or `/construct scan` to verify no drift remains.

## Why is `github:spf13/go-skills` shown as a package declaration, not as a skill?

A GitHub source in `.pi/settings.json` is a package declaration, even if that package provides skills internally.

Construct scan separates:

- **Package declarations** — entries from `.pi/settings.json`;
- **Direct skills** — project-local files under `.pi/skills/`;
- **Direct prompts** — project-local files under `.pi/prompts/`;
- **Direct themes** — project-local files under `.pi/themes/`;
- **Direct extensions** — project-local files under `.pi/extensions/`.

Construct does not inspect package internals during scan. This keeps scan conservative and avoids turning Construct into a package manager/resource crawler.

## Why did scan not pick up old skills/extensions I remember seeing?

Check which bucket they came from.

### Package-provided resources

If the skills/extensions came from an installed package, they may live under package cache folders such as:

```text
.pi/git/
.pi/npm/
```

Construct scan intentionally does not crawl those cache folders. It reports the package declaration from `.pi/settings.json`, not every skill, command, tool, or extension file inside that package.

If the package declaration is already loaded into Construct, scan will not show those package internals as unloaded direct resources.

### Direct project resources

Scan only reports direct resources when they exist under project-local paths such as:

```text
.pi/skills/
.pi/extensions/
.pi/prompts/
.pi/themes/
```

If those folders are empty or missing, there are no direct resources for scan to pick up.

### Old package caches

A package cache can remain after a package declaration is removed, or it can disappear after cleanup. Cache contents are not Construct's source of truth.

To restore a package that used to provide skills/extensions, restore the package declaration through the dashboard Available row or Pi:

```bash
pi install <source> -l --approve
```

Then run:

```text
/construct load
```

if it needs to be remembered by Construct again.

### Trust misses

If scan skipped projects because they were not trusted by Pi, print scan will say so under `Skipped projects` and show a non-zero skipped count.

If scan says:

```text
Skipped untrusted projects: 0
```

then trust was not the reason those resources were missing from the report.

## What should I check before reporting a drift bug?

Run:

```text
/construct status full
/construct scan
```

Then inspect these files:

```text
.pi/settings.json
.pi/construct.json
```

Useful questions:

- Is the package actually declared in `.pi/settings.json`?
- Is it disabled by package filters?
- Does `.pi/construct.json` still have an item for a package that is no longer declared?
- Did a recent `pi remove`, branch switch, restore, or manual edit change `.pi/settings.json`?
- Did Construct report a metadata-only failure after an operation?

If print scan ends with `No files were changed.`, no reconciliation happened yet. Use TUI scan to apply selected repairs.
