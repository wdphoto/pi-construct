# Architecture and data model

Construct is a global Pi extension / Pi package with one primary command: `/construct`.

The current implementation now inventories and toggles packages plus direct project Pi extensions, skills, prompt templates, and themes. The portable library/saved-loadout model remains package-source-only until a direct-resource portability/export model is designed. See `docs/project-resource-loadout-plan.md`.

## Layers

1. **Command layer**
   - Registers `/construct`.
   - Supports public `status`, `load`, `unload`, `autoload`, `save`, `saved`, `run`, `copy`, and `import` subcommands.
   - Keeps `/construct profile list|save|apply` as compatibility aliases for the internal saved-loadout model.
   - Default `/construct` opens the loadout dashboard in TUI mode or prints a read-only dashboard in print mode.

2. **Dashboard layer**
   - Merges Construct library entries, saved loadouts, current project package declarations, direct project resource inventory, package filter state, and Construct metadata.
   - Direct project resource rows are read-only until adopted; after `/construct load` adopts them into metadata, Enter toggles them with Pi-native top-level resource filters.
   - Uses selected rows plus one fast normal action and one destructive action rather than treating checkboxes as current package state.
   - Enter applies/runs the obvious action for actionable rows: run Saved, install Available, disable Active, or enable Disabled.
   - `r` asks for confirmation, then removes selected Active or Disabled project package declarations.
   - Keeps Unloaded rows clearly labeled as project declarations/resources not yet loaded into Construct; `/construct load` is the adoption path.
   - In TUI mode, keeps the title quiet (`Loadout: ...`), row text plain, and color limited to the state icon column: saved accent, active green, disabled muted green, available yellow, unloaded gray.

3. **Package operation layer**
   - Loads available sources with Pi's native project-local install path:
     ```bash
     pi install <source> -l --approve
     ```
   - Disables installed/active sources by keeping the package declaration and setting Pi package resource filters to empty arrays.
   - Enables disabled sources by clearing those all-empty package resource filters.
   - Toggles Construct-managed direct resources by writing Pi-native top-level `+path` / `-path` filters in `.pi/settings.json`.
   - Removes package declarations only through the explicit dashboard remove action, using Pi's native project-local remove path first:
     ```bash
     pi remove <source> -l --approve
     ```
   - Falls back to conservative `.pi/settings.json` edits only when needed.
   - Backs up `.pi/settings.json` before direct edits.
   - Re-reads relevant project/Construct JSON after idle waits or long-running package operations before merging metadata.

4. **Construct library layer**
   - User-local file: `~/.pi/agent/construct/catalog.json`.
   - Contains remembered package source strings and saved loadouts (`profiles` internally); direct project-local resources are not stored in the portable library yet.
   - Updated only by explicit `/construct load`, `/construct unload`, and `/construct save` commands.

5. **Known-project index layer**
   - User-local file: `~/.pi/agent/construct/projects.json`.
   - Tracks projects Construct has touched and their package declarations.
   - Counts are informational only and should be labeled as “known projects,” not full filesystem usage.

6. **Project metadata layer**
   - Project-local file: `.pi/construct.json`.
   - Advisory only; `.pi/settings.json` wins when there is disagreement.
   - Tracks Construct-managed package items and enabled state.

7. **Inventory layer**
   - Reads `.pi/settings.json` for project package declarations.
   - Reads `.pi/construct.json` for advisory state.
   - Uses Pi's exported `DefaultPackageManager.resolve()` and `SettingsManager` to inventory direct project extensions, skills, prompt templates, and themes with Pi's own discovery/trust/filter semantics.
   - Reports direct resources in `/construct status full` and as dashboard rows; `/construct load` can adopt direct project resources into `.pi/construct.json` metadata.
   - Uses `pi.getCommands()`, `pi.getAllTools()`, and `pi.getActiveTools()` for runtime diagnostics only.

## Data model

### User library: `~/.pi/agent/construct/catalog.json`

```json
{
  "version": 1,
  "items": [
    {
      "id": "browser-tools",
      "name": "Browser tools",
      "kind": "package",
      "source": "npm:@org/pi-browser-tools",
      "description": "Browser automation extension and skills",
      "groups": ["website"]
    },
    {
      "id": "agent-tools",
      "name": "Agent tools",
      "kind": "package",
      "source": "git:github.com/org/pi-agent-tools",
      "description": "Project helpers from a git package",
      "groups": ["website"]
    }
  ],
  "profiles": [
    {
      "id": "www",
      "name": "www",
      "kind": "profile",
      "items": ["browser-tools", "agent-tools"],
      "sources": ["npm:@org/pi-browser-tools", "git:github.com/org/pi-agent-tools"]
    }
  ]
}
```

Rules:

- `source` is replayed by dashboard operations through Pi's normal project-local package install.
- Preserve source strings exactly except local path normalization during load.
- Future direct-resource catalog items may use `kind: "extension" | "skill" | "prompt" | "theme"` plus a path/ref and portability marker; existing package items remain valid. Current saved loadouts/share snippets remain package-source-only.
- Unknown item fields should be preserved where possible for forward compatibility.

### Project metadata: `.pi/construct.json`

```json
{
  "version": 1,
  "managedBy": "the-construct",
  "targetCwd": "/absolute/path/to/project",
  "items": {
    "browser-tools": {
      "kind": "package",
      "source": "npm:@org/pi-browser-tools",
      "enabled": true,
      "loadedAt": "2026-06-15T00:00:00.000Z",
      "updatedAt": "2026-06-15T00:00:00.000Z"
    },
    "agent-tools": {
      "kind": "package",
      "source": "git:github.com/org/pi-agent-tools",
      "enabled": true,
      "loadedAt": "2026-06-15T00:00:00.000Z",
      "updatedAt": "2026-06-15T00:00:00.000Z"
    }
  }
}
```

Rules:

- Metadata only.
- Do not store secrets, env values, auth material, or generated package cache paths.
- Read-only commands must not create this file.

## Write behavior

Construct writes JSON through a shared helper that writes a complete temporary file in the same directory, flushes it, then renames it over the target. Direct `.pi/settings.json` edits still create a timestamped backup first.

## Related design notes

- `docs/pi-config-and-construct.md` explains how Construct differs from Pi's native `pi config` resource toggles and records the filter-based disarm direction.
- `docs/package-disable-design.md` records the disable/disarm package action model while keeping Construct's own menu.
- `docs/autoload-transparency.md` records autoload watcher mechanics, cost, caveats, and future UX improvements.

## Lifecycle behavior

Construct does not open menus, install packages, reload Pi, or write files just because Pi starts.

Autoload is explicit opt-in behavior. Its reliable baseline is the session-quit scan: when enabled in a trusted TUI project, Construct can ask before loading unloaded package sources into Construct. The detailed transparency doc also describes the current settings watcher used for after-install visibility. Both paths are confirmation-only and metadata-only.
