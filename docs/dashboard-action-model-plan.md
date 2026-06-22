# Dashboard action model plan

Status: implemented. Originally package-only; current dashboard uses `Active` for active package/direct-resource rows and shows adopted direct project resources alongside packages. Manual TUI verification is still useful before release.

## Problem

The dashboard has been drifting toward too many verbs:

- `load`
- `enable`
- `disable`
- `remove`
- `unload`
- `installed`
- `loaded`

That makes the fast path slower and makes the labels do too much work. The biggest issue is that `Loaded` is a bad user-facing state. Users think in package/project terms: is this package in this project, off in this project, available to install here, or only sitting in the project outside Construct?

## Opinionated direction

Use four states:

```text
Active      project-declared/adopted, active, and Construct-managed
Disabled    project-declared/adopted and Construct-managed, but Pi filters are off
Available   remembered package source, not declared in this project
Unloaded    project-declared/adoptable, but not loaded/adopted into Construct
```

Keep the dashboard fast:

```text
Space selects · Enter applies · r removes · Esc cancels
```

`Enter` is the normal state-transition key:

| State | Enter does | Writes `.pi/settings.json`? |
| --- | --- | --- |
| `Available` | installs/adds the package to this project with `pi install <source> -l --approve` | yes |
| `Active` | disables the selected package/direct resource by writing Pi filters | yes |
| `Disabled` | enables the selected package/direct resource by clearing/writing Pi filters | yes |
| `Unloaded` | read-only in `/construct`; use `/construct load` to adopt it | no |

`r` is the destructive key:

| State | r does |
| --- | --- |
| `Active` | removes the project package declaration for package rows; direct-resource rows are not removable |
| `Disabled` | removes the project package declaration for package rows; direct-resource rows are not removable |
| `Unloaded` | no-op/read-only in `/construct`; use Pi directly if you want to remove project-only package declarations/resources |
| `Available` | no-op; there is no project declaration to remove |

`r` must show a warning/confirmation before applying to removable rows. It is faster than an action chooser but still has friction before a destructive settings edit.

## Pushback / things not to do

### Do not keep `d` as a public key

If `Enter` disables installed packages, `d` becomes duplicate behavior. Duplicate shortcuts sound harmless but create questions:

- Does `d` differ from Enter?
- Which one is safer?
- Why does `d` only work for one state?
- Why does typing `d` sometimes filter and sometimes mutate?

Drop public `d`. Do not keep a hidden compatibility path unless real users complain. This is pre-1.0 and the cleaner model is worth the small break.

### Do not call this a full uninstall in primary UI copy

`r` currently uses:

```bash
pi remove <source> -l --approve
```

That is the right implementation. But user-facing copy should say “remove from this project” more often than “uninstall,” because Pi remove edits project settings and does not promise to delete every cached clone/package from disk.

Use “remove” in controls and result summaries. The confirmation can mention project-local `pi remove` for technical clarity.

### Do not make Space cycle destructive states

Space only selects. It must not cycle `Active -> Disabled -> Remove`, because removal is destructive and should not be reachable through the selection key.

### Do not bring back an action chooser

The action chooser is safer but too slow for the core loop. The dashboard is a loadout switchboard; Enter should apply the obvious transition for actionable states. Unloaded is the exception: keep adoption in `/construct load` so the main menu does not mutate Construct metadata for project-only declarations.

## Technical notes

### Dashboard section mapping

Managed package rows:

- declared in `.pi/settings.json` and not disabled by filters -> `Active`
- declared in `.pi/settings.json` and disabled by filters -> `Disabled`
- not declared in `.pi/settings.json` -> `Available`

Catalog-only rows:

- not declared in `.pi/settings.json` -> `Available`

Project-only rows:

- declared in `.pi/settings.json` but not Construct-managed -> `Unloaded`
- if also disabled by filters, still show as `Unloaded`; the description should mention filters if useful
- rows are disabled/read-only in `/construct`; `/construct load` is the adoption path

Direct project-resource rows:

- resolved by Pi from `.pi/extensions/`, `.pi/skills/`, `.pi/prompts/`, or `.pi/themes/`
- before adoption into `.pi/construct.json` -> `Unloaded`
- after adoption and active in Pi filters -> `Active`
- after adoption and disabled by Pi top-level `-path` filter -> `Disabled`
- no dashboard delete path; direct resource file deletion remains outside Construct

### Enter behavior implementation

Current helpers already exist for most operations:

```ts
loadPackageIntoProject(pi, paths, { source, item })
disablePackageResourcesInProject(paths, { source, id })
enablePackageResourcesInProject(paths, { source, id })
removePackageFromProject(pi, paths, { source, id })
```

Do not add a dashboard path for `Unloaded -> Enter`. Reuse `/construct load` as the only adoption flow. The `/construct load` internals should preserve disabled-filter intent when adopting disabled project declarations.

Implemented supporting change:

- `upsertConstructItem(..., { enabled })` accepts the intended metadata enabled state;
- `loadSourcesIntoConstruct(..., { enabledBySource })` passes that state through;
- `/construct load` passes `enabled: false` when adopting a project declaration already disabled by all-empty filters.

This avoids creating immediate “enabled metadata, disabled by filters” drift for disabled package declarations loaded through `/construct load`.

### Remove confirmation implementation

Add a generic remove confirmation phase to `pickCheckboxes()`:

- pressing `r` with selected rows asks `options.removeConfirmation?.(selectedIds)`;
- if it returns a confirmation payload, render a warning panel;
- Enter confirms and starts the `remove` submit;
- Esc returns to the picker without writing;
- if no removable selected rows exist, skip the warning and let the dashboard return its no-op result.

Do not make this dashboard-specific inside the TUI primitive except for the generic hook.

Suggested warning copy:

```text
Remove from this project?

This will run project-local `pi remove` for N package(s).
It edits `.pi/settings.json` after creating a backup.
It does not delete global Pi package caches.

Press Enter to remove · Esc cancels
```

### Print-mode markers

Print mode can keep state markers:

```text
[x] Active
[-] Disabled
[ ] Available
[u] Unloaded
```

TUI mode should not force fixed markers on selectable rows, because fixed markers hide Space selection state. `Unloaded` is read-only, so it may keep a fixed `[u]` marker.

## Acceptance criteria

- [x] Dashboard sections and counters are `Active`, `Disabled`, `Available`, `Unloaded`.
- [x] No public dashboard hint mentions `d`.
- [x] Pressing Enter on selected `Active` rows disables them.
- [x] Pressing Enter on selected `Disabled` rows enables them.
- [x] Pressing Enter on selected `Available` rows installs/adds them to the project.
- [x] `Unloaded` rows are read-only in `/construct`.
- [x] `/construct load` shows only unloaded/adoptable options in TUI mode.
- [x] `/construct load <id-or-source-or-path ...>` directly adopts matching unloaded/adoptable project package declarations and direct resources.
- [x] Pressing `r` on selected actionable project-declared rows shows a confirmation before `pi remove`/fallback settings edit.
- [x] Pressing `r` on only `Available` rows does not show a destructive warning and reports that nothing project-local can be removed.
- [x] `/construct unload` output says still-active forgotten packages will show as `Unloaded`, not `Active` or `Loaded`.
- [x] Smoke tests cover the renamed sections and disabled-filter detection.
- [ ] Manual TUI verification confirms the key feel and remove warning copy.
