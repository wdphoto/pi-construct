# Package disable/disarm model

Construct uses Pi package filters to turn Construct-managed packages off without removing their project package declarations.

## Product boundary

Pi's native `pi config` is the resource selector. It can toggle individual extensions, skills, prompts, and themes inside a package.

Construct is the loadout menu. Package rows work at package level:

- install/declare remembered packages in the current project;
- disable or enable a Construct-managed project package;
- explicitly remove a Construct-managed package declaration from the project;
- load/adopt project package declarations into the Construct library.

Construct can also adopt and toggle direct project-local resources such as `.pi/skills/`, `.pi/prompts/`, `.pi/themes/`, and `.pi/extensions/` using Pi-native top-level filters. It still does not browse or toggle individual package-contained resources.

Do not embed `pi config` or grow Construct into a broad resource browser.

## State language

Use these labels consistently:

- **Active**: declared/adopted, active, and Construct-managed.
- **Disabled**: declared/adopted, Construct-managed, and disabled by Pi package or direct-resource filters.
- **Available**: remembered package source in the Construct library, not declared in this project.
- **Unloaded**: declared/adoptable in this project but not loaded/adopted into Construct.
- **Removed from project**: package declaration removed from `.pi/settings.json`.
- **Unloaded from Construct**: forgotten from Construct library/metadata only; project declarations remain untouched.

Prefer `Disabled` in UI copy because it matches Pi config language. `Disarmed` can remain explanatory flavor, not a state name.

## Dashboard action model

Current controls:

```text
Space selects · Enter applies · r removes · Esc cancels
```

Enter applies the obvious non-destructive state transition:

| State | Enter does |
| --- | --- |
| `Available` | install/declare into this project with `pi install <source> -l --approve` |
| `Active` | disable by setting package resource filters to empty arrays; direct-resource rows write top-level `-path` filters |
| `Disabled` | enable by clearing all-empty package resource filters; direct-resource rows write top-level `+path` filters |
| `Unloaded` | no-op/read-only; use `/construct load` |

`r` is the destructive cleanup key:

| State | `r` does |
| --- | --- |
| `Active` | for package rows: confirm, then remove the project package declaration; direct-resource rows are not removable in Construct |
| `Disabled` | for package rows: confirm, then remove the project package declaration; direct-resource rows are not removable in Construct |
| `Available` | no-op; use `/construct unload` to forget from the library |
| `Unloaded` | no-op/read-only; use Pi directly if needed |

No public `d` key. It duplicates Enter for Active rows and conflicts mentally with type-to-filter.

## Settings semantics

### Disable package resources

A string package declaration:

```json
"packages": ["npm:some-pi-package"]
```

becomes an object with every package resource family filtered to none:

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

For an existing object package entry, preserve unknown fields where possible and overwrite only these resource filter keys.

### Enable package resources

Enabling removes the all-empty filter keys, so Pi returns to manifest/default loading. If the remaining object is only `{ "source": "..." }`, Construct may write it back as the string source form.

Construct does **not** currently store and restore arbitrary prior partial filters. Add that only if users need richer resource-filter preservation.

### Remove package declaration

Removal is explicit and confirmed. Construct tries Pi's normal project-local remove path first:

```bash
pi remove <source> -l --approve
```

If Pi cannot match the source, Construct may fall back to a conservative `.pi/settings.json` edit. Direct settings edits must back up `.pi/settings.json` first.

## Metadata semantics

`.pi/settings.json` remains source of truth.

`.pi/construct.json` stores advisory intent:

- `enabled: true`: Construct expects the package to be active.
- `enabled: false`: Construct expects the package to be disabled.

Status/drift should distinguish:

- metadata enabled, settings missing source: drift;
- metadata enabled, package disabled by filters: drift;
- metadata disabled, package declared with all-empty filters: OK;
- settings package disabled by filters without Construct metadata: project package is disabled outside Construct.

## Safety rules

- Wait for Pi idle before mutating files.
- Back up `.pi/settings.json` before direct edits.
- Do not silently remove declarations when the user expects disable.
- Say when reload is needed.
- Keep Unloaded rows read-only in `/construct`; adoption belongs to `/construct load`.

## Implementation touchpoints

```ts
packageResourcesDisabled(entry)
setMatchingPackageResourcesDisabled(paths, source, disabled)
disablePackageResourcesInProject(paths, { source, id })
enablePackageResourcesInProject(paths, { source, id })
removePackageFromProject(pi, paths, { source, id })
```

Current smoke coverage verifies disabled-filter detection. Manual TUI verification is still useful for action-key feel, remove confirmation copy, and result-panel reload behavior.
