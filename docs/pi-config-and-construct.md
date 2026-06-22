# Pi config and Construct

This note captures the current understanding of how Pi's native `pi config` resource configuration overlaps with Construct, and where Construct should stay different.

## Sources checked

Local Pi docs/source inspected on 2026-06-20:

- `/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/docs/settings.md`
- `/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/docs/packages.md`
- `/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/dist/cli/config-selector.d.ts`
- `/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/components/config-selector.js`
- `/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/dist/core/settings-manager.d.ts`
- `/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/dist/core/package-manager.d.ts`

## What Pi config does

`pi config` is Pi's native resource selector. It enables/disables package-contained and top-level resources:

- extensions
- skills
- prompts
- themes

It works at both global and project scope. Pi settings support package object filters:

```json
{
  "packages": [
    {
      "source": "pi-skills",
      "skills": ["brave-search"],
      "extensions": []
    }
  ]
}
```

Filter semantics from Pi docs:

- Omitted key: load all resources of that type allowed by the package manifest.
- Empty array: load none of that type.
- `!pattern`: exclude matches.
- `+path`: force include exact path.
- `-path`: force exclude exact path.

Pi's `config-selector` implements toggles by writing those filters through `SettingsManager`.

## What Construct does today

Construct is a loadout manager, not a full resource selector.

Current dashboard behavior separates package actions:

- Load available package: `pi install <source> -l --approve`
- Enable disabled package: clear all-empty package resource filters
- Disable installed/active package: set package resource filters to `[]`
- Remove from project: explicit `r` action using `pi remove <source> -l --approve` first

Construct also keeps advisory metadata:

- `.pi/construct.json`
- `~/.pi/agent/construct/catalog.json`
- `~/.pi/agent/construct/projects.json`

Construct should continue to treat `.pi/settings.json` as the source of truth.

## Key difference

Pi config toggles resources **inside** a package while keeping the package declaration.

Construct manages package-level loadout actions while avoiding individual resource browsing.

The Pi-native disabled state is represented as a package object with all resource types disabled:

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

This keeps the source declared in `.pi/settings.json` while disarming its runtime resources.

## Construct disable/disarm direction

Construct now has an initial disable/disarm implementation that uses Pi package filters instead of removing package declarations.

Benefits:

- More Pi-native: uses the same filter model as `pi config`.
- Less destructive: package source remains visible in `.pi/settings.json`.
- Potentially fewer subprocess calls if implemented with `SettingsManager` / `DefaultPackageManager`.
- Better alignment with loadout language: packages are armed/disarmed rather than installed/removed.

Current answers:

- A package with all resource arrays set to `[]` is shown as `Disabled`.
- `/construct load` can still adopt disabled package declarations as package declarations; broader disabled-specific load UX can be refined later.
- Saved-loadout run still resets toward enabled/current behavior and can be revisited separately.
- Dashboard Enter applies the obvious state change for actionable rows: install Available, disable Active, or enable Disabled. Unloaded rows are read-only there; `/construct load` adopts them. `r` explicitly confirms and removes Active or Disabled project package declarations.
- Status/drift distinguishes “disabled by package filters” from “missing from .pi/settings.json”.

## What we can reuse safely

### SettingsManager

Pi exports `SettingsManager` with methods such as:

- `setProjectPackages(packages)`
- `setPackages(packages)`
- `setProjectExtensionPaths(paths)`
- `setProjectSkillPaths(paths)`
- `setProjectPromptTemplatePaths(paths)`
- `setProjectThemePaths(paths)`
- `flush()`

Construct can consider using `SettingsManager` for future settings writes instead of manual JSON edits or CLI subprocesses, especially for package filter writes.

Keep Construct's backup/safety behavior unless we deliberately decide Pi's locking and flush semantics are enough.

### DefaultPackageManager

Pi exports `DefaultPackageManager` with methods including:

- `installAndPersist(source, { local: true })`
- `removeAndPersist(source, { local: true })`
- `listConfiguredPackages()`
- `resolve()`

This could replace `pi.exec("pi", ["install"...])` / `pi.exec("pi", ["remove"...])` in a future refactor.

Caution: CLI behavior is a stable user-facing contract. Direct use of Pi internals may be more coupled to Pi implementation details, so verify stability before replacing subprocess calls.

## What not to do

Do not turn Construct into another `pi config` or `pi-resource-center`.

Avoid adding broad resource-management commands such as:

- enable/disable individual skills/extensions/prompts/themes
- expose/hide package-contained resources
- update/remove resource families
- a general resource browser

Those belong to Pi config or a resource-center style package. Construct's product lane remains loadouts, saved loadouts, sharing, and known-project context.

## Current recommendation

Keep the disable/remove split:

- Disable by Pi package filters for reversible “turn it off” behavior.
- Remove package declarations only through explicit cleanup actions.
- Keep `/construct unload` as Construct-library/metadata-only.

Continue to validate the TUI action keys manually. Enter should stay fast for normal state changes; `r` should stay explicit and confirmed because it removes project package declarations.

See `docs/package-disable-design.md` for the dashboard/action design.
