# Package disable/disarm design

This records the dashboard package action model introduced after the Pi config research. It is implemented as an initial pass; exact keybindings/wording can still be refined after manual TUI use.

## Context

Pi's native `pi config` TUI shows package-contained resources and lets users toggle individual extensions, skills, prompts, and themes. Construct should not reuse or expose that TUI directly; Construct remains its own loadout menu.

However, Pi's underlying package filter model gives Construct a more native way to turn a package “off” without removing its package declaration from `.pi/settings.json`.

Older Construct dashboard off behavior used Pi's remove path:

```bash
pi remove <source> -l --approve
```

Construct now separates disable from removal. Disable/disarm keeps the package source declared and sets all package resource filters to empty arrays:

```json
{
  "packages": [
    {
      "source": "npm:some-pi-package",
      "extensions": [],
      "skills": [],
      "prompts": [],
      "themes": []
    }
  ]
}
```

This is closer to Pi's native resource-configuration model and avoids firing a remove command for ordinary dashboard off actions.

## Terminology

Use distinct words for distinct operations:

- **Loaded**: package declaration is present and at least one package resource type can load.
- **Disabled** or **Disarmed**: package declaration is present, but Construct/Pi filters disable all package-contained resource types.
- **Installed**: source is declared in the project but not loaded into Construct metadata/library.
- **Available**: source is remembered in the Construct library but not declared in this project.
- **Removed from project**: package declaration is removed from `.pi/settings.json`.
- **Unloaded from Construct**: resource is forgotten from Construct library/metadata only; project package declarations are left alone.

Open naming question: `Disabled` is familiar from Pi config; `Disarmed` fits Construct language. Favor `Disabled` in user-facing state if we want native wording, and use “disarm” as explanatory language only if it tests well.

## Proposed dashboard behavior

Keep the one Construct menu. Do not open or embed `pi config`.

Default dashboard sections could become:

```text
Loaded
------
[x] package-a    npm:package-a

Disabled
--------
[-] package-b    npm:package-b

Installed
---------
[i] package-d    /local/package-d

Available
---------
[ ] package-c    npm:package-c
```

Possible markers:

- `[x]` loaded / active
- `[-]` disabled/disarmed by filters
- `[i]` installed/project-declared but not loaded into Construct
- `[ ]` available / not declared here

## Interaction model

Use `Installed` narrowly to mean “declared in this project but not loaded into Construct.” This is project-level state, not a claim about Pi's package cache.

### Implemented action model

Space selects rows. The action key decides what happens to selected rows.

Current controls:

```text
Space selects · Enter loads/enables · d disables · r removes project declarations · Esc cancels
```

Current behavior:

- Enter loads/enables selected packages:
  - `Available` -> install/declare into this project using Pi's normal project-local install path.
  - `Disabled` -> enable by clearing all-empty package resource filters.
  - `Loaded` -> ignored by the Enter action because it is already enabled.
- `d` disables selected `Loaded` packages by setting package resource filters to empty arrays.
- `r` removes selected `Loaded`, `Disabled`, or `Installed` package declarations from the project. Delete may remain a best-effort alias, but terminal Delete handling is not reliable enough to advertise.
- `Available` rows are not project-declared, so `r` has nothing to remove from the project. Use `/construct unload` to make Construct forget library items.
- `Installed` rows are removable from the project but still guide users to `/construct load` if they want to add them to Construct.
- Enter on the result panel reloads Pi when changes were applied; Esc returns to the session without reloading.

This preserves the favorite install flow: Space select one or more Available packages, press Enter, then Enter reloads from the result panel.

The section heading communicates current state; the checkbox marker communicates row selection in TUI mode. Print mode can still show state markers such as `[x]`, `[-]`, `[i]`, and `[ ]`.

### Why not make Space cycle through remove?

Do not cycle `Loaded -> Disabled -> Remove -> Loaded` with Space. It makes the common key include a destructive cleanup action, is harder to explain, and increases the chance of accidentally removing project declarations.

### Deferred alternative: action panel

The current implementation uses direct action keys. If those feel too hidden or conflict with type-to-filter, replace direct keys with an action panel instead.

### Multi-choice model

If we still need both “disable” and “remove from project,” do not overload Space.

Possible flow:

1. User selects rows with Space.
2. User presses Enter.
3. If selected changes include turning loaded packages off, show an action panel:

```text
Turn off selected packages how?

> Disable resources, keep package declarations  (recommended)
  Remove package declarations from this project
  Cancel
```

Recommended default: **Disable resources, keep package declarations**.

This keeps ordinary users on the safer Pi-native path while preserving a deliberate removal escape hatch.

### Keybinding caveat

The current `d` action only fires when at least one row is selected; otherwise `d` remains normal filter text. If this feels surprising in manual TUI testing, move disable/remove behind an action panel.

## Settings semantics

### Disable package resources

Given a project package entry:

```json
"packages": ["npm:some-pi-package"]
```

Disable becomes:

```json
"packages": [
  {
    "source": "npm:some-pi-package",
    "extensions": [],
    "skills": [],
    "prompts": [],
    "themes": []
  }
]
```

For an existing object entry, preserve unknown fields if possible and overwrite only these resource filter keys:

```json
{
  "source": "npm:some-pi-package",
  "extensions": [],
  "skills": [],
  "prompts": [],
  "themes": []
}
```

### Enable package resources

Open question: should enabling restore exact previous filters?

Minimum implementation:

- Convert fully disabled object back to string form if no other fields exist.
- Or remove `extensions`, `skills`, `prompts`, and `themes` keys from the object, causing Pi to load all manifest-allowed resources.

Potential richer implementation:

- Store previous filter state in `.pi/construct.json` before disabling.
- Restore that filter state when enabling.

Current implementation does not store/restore arbitrary prior filters. Keep that behavior unless users ask for richer filter preservation.

### Remove package declaration

Removal is an explicit dashboard action, not the default off behavior.

Removal currently uses Pi's package remove path first, or later can move to Pi's `DefaultPackageManager.removeAndPersist(source, { local: true })` after we verify that direct API is stable enough for extension use.

## Metadata semantics

`.pi/construct.json` continues to track Construct-managed package items with an `enabled` boolean:

- `enabled: true`: package intended to be active/loaded.
- `enabled: false`: package intended to be disabled/disarmed.

If we need to distinguish disabled-by-filters from removed-from-project, add a conservative field later:

```json
{
  "kind": "package",
  "source": "npm:some-pi-package",
  "enabled": false,
  "state": "disabled"
}
```

Avoid adding this until implementation needs it; `.pi/settings.json` remains source of truth.

## Status and drift rules

Status should distinguish:

- Construct metadata says enabled, settings missing source: drift.
- Construct metadata says disabled, settings still has source with all package filters empty: OK.
- Construct metadata says disabled, settings missing source: removed from project or drift depending wording.
- Settings has source with all package filters empty but no Construct metadata: project package is disabled outside Construct.

Dashboard labels should make the source of truth clear:

- `Disabled` = declared in `.pi/settings.json`, package resources disabled by filters.
- `Available` = remembered by Construct but absent from `.pi/settings.json`.
- `Installed` = present in `.pi/settings.json` but not loaded into Construct.

## Safety rules

- Before direct edits to `.pi/settings.json`, keep backup behavior unless deliberately replaced by Pi's locked `SettingsManager` writes.
- Wait for Pi idle before writing, same as current Construct file-changing flows.
- Do not call or embed `pi config` TUI.
- Do not add broad resource-level management to Construct.
- Do not silently remove package declarations when user expects disable.
- Clearly say when reload is needed.

## Implementation notes

Current helper shape:

```ts
packageResourcesDisabled(entry)
setMatchingPackageResourcesDisabled(paths, source, disabled)
disablePackageResourcesInProject(paths, { source, id })
enablePackageResourcesInProject(paths, { source, id })
removePackageFromProject(pi, paths, { source, id })
```

Current smoke coverage verifies read/status detection for disabled package filters. Manual TUI verification is still needed for action keys and result-panel reload behavior.

## Recommendation

Keep this split:

- Enter action: load/enable selected packages.
- `d` action: disable selected loaded packages, keeping package declarations.
- `r` action: explicitly remove selected project package declarations.
- `/construct unload`: library/metadata-only, never edits `.pi/settings.json`.

This makes Construct more native to Pi while preserving its separate product identity and quiet one-menu workflow.
