# Architecture and data model

Construct is a global Pi extension / Pi package with one primary command: `/construct`.

## Layers

1. **Command layer**
   - Registers `/construct`.
   - Supports public `status`, `sync`, and `profile` subcommands.
   - Default `/construct` opens the loadout dashboard in TUI mode or prints a read-only dashboard in print mode.

2. **Dashboard layer**
   - Merges Construct library entries, current project package declarations, and Construct metadata.
   - Applies package on/off diffs through internal package operations.
   - Keeps project-only rows clearly labeled and read-only.

3. **Package operation layer**
   - Turns sources on with Pi's native project-local install path:
     ```bash
     pi install <source> -l --approve
     ```
   - Turns sources off with Pi's native project-local remove path:
     ```bash
     pi remove <source> -l --approve
     ```
   - Falls back to conservative `.pi/settings.json` edits only when needed.
   - Backs up `.pi/settings.json` before direct edits.

4. **Construct library layer**
   - User-local file: `~/.pi/agent/construct/catalog.json`.
   - Contains remembered package source strings and saved profiles.
   - Updated only by explicit `/construct sync` and `/construct profile save` commands.

5. **Project metadata layer**
   - Project-local file: `.pi/construct.json`.
   - Advisory only; `.pi/settings.json` wins when there is disagreement.
   - Tracks Construct-managed package items and enabled state.

6. **Inventory layer**
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
    }
  ],
  "profiles": [
    {
      "id": "www",
      "name": "www",
      "kind": "profile",
      "items": ["browser-tools"],
      "sources": ["npm:@org/pi-browser-tools"]
    }
  ]
}
```

Rules:

- `source` is replayed by dashboard operations through Pi's normal project-local package install.
- Preserve source strings exactly except local path normalization during adoption.
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
    }
  }
}
```

Rules:

- Metadata only.
- Do not store secrets, env values, auth material, or generated package cache paths.
- Read-only commands must not create this file.

## Startup behavior

Construct has no lifecycle/startup behavior. It does not prompt, sync, install, reload, or write files just because Pi starts.
