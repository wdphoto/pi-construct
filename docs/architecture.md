# Architecture and data model

Construct is a global Pi extension / Pi package with one primary command: `/construct`.

## Layers

1. **Command layer**
   - Registers `/construct`.
   - Supports public `status`, `load`, `unload`, `autoload`, and WIP `profile` subcommands.
   - Default `/construct` opens the loadout dashboard in TUI mode or prints a read-only dashboard in print mode.

2. **Dashboard layer**
   - Merges Construct library entries, current project package declarations, package filter state, and Construct metadata.
   - Uses selected rows plus one fast normal action and one destructive action rather than treating checkboxes as current package state.
   - Enter applies the obvious state change for actionable rows: install Available, disable Installed, or enable Disabled.
   - `r` asks for confirmation, then removes selected Installed or Disabled project package declarations.
   - Keeps Unloaded rows clearly labeled as project declarations not yet loaded into Construct; `/construct load` is the adoption path.

3. **Package operation layer**
   - Loads available sources with Pi's native project-local install path:
     ```bash
     pi install <source> -l --approve
     ```
   - Disables installed/active sources by keeping the package declaration and setting Pi package resource filters to empty arrays.
   - Enables disabled sources by clearing those all-empty package resource filters.
   - Removes package declarations only through the explicit dashboard remove action, using Pi's native project-local remove path first:
     ```bash
     pi remove <source> -l --approve
     ```
   - Falls back to conservative `.pi/settings.json` edits only when needed.
   - Backs up `.pi/settings.json` before direct edits.

4. **Construct library layer**
   - User-local file: `~/.pi/agent/construct/catalog.json`.
   - Contains remembered package source strings and saved profiles.
   - Updated only by explicit `/construct load`, `/construct unload`, and `/construct profile save` commands.

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

## Related design notes

- `docs/pi-config-and-construct.md` explains how Construct differs from Pi's native `pi config` resource toggles and records the filter-based disarm direction.
- `docs/package-disable-design.md` records the disable/disarm package action model while keeping Construct's own menu.
- `docs/autoload-transparency.md` records autoload watcher mechanics, cost, caveats, and future UX improvements.

## Lifecycle behavior

Construct has no startup adoption behavior. It does not open menus, install packages, reload Pi, or write files just because Pi starts.

Autoload is explicit opt-in behavior. When enabled in a trusted TUI project, Construct can watch `.pi/settings.json` during the session and prompt before loading newly declared package sources into Construct. It also scans on session quit. Both paths are confirmation-only and metadata-only.
