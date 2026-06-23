# Architecture and data model

Construct is a global Pi extension / Pi package with one primary command: `/construct`.

The current implementation inventories and toggles packages plus direct project Pi extensions, skills, prompt templates, and themes. Decision: the portable library/saved-loadout model remains package-source-only for now; direct resources stay project-local until a direct-resource portability/export model is deliberately designed.

## Layers

1. **Command layer**
   - Registers `/construct`.
   - Supports public `status`, `scan`, `load`, `unload`, `save`, `list`, `run`, `share`, `wipe`, and `import` subcommands.
   - Default `/construct` opens the loadout dashboard in TUI mode or prints a read-only dashboard in print mode.

2. **Dashboard layer**
   - Merges Construct library entries, saved loadouts, current project package declarations, direct project resource inventory, package filter state, and Construct metadata.
   - Direct project resource rows are read-only until adopted; after `/construct load` adopts them into metadata, Enter toggles them with Pi-native top-level resource filters.
   - Uses selected rows plus one fast normal action and one destructive action rather than treating checkboxes as current package state.
   - Enter applies/runs the obvious action for actionable rows: run Loadouts, install Available, disable Active, or enable Disabled.
   - `r` asks for confirmation, then removes selected Active or Disabled project package declarations; package-contained child resources are filtered, not removed individually.
   - Keeps Unloaded rows clearly labeled as project declarations/resources not yet loaded into Construct; `/construct load` is the adoption path.
   - In TUI mode, keeps the title quiet while showing the package/version string and count line, keeps cursor/checkbox markers plain, colors row content by state, and bolds focused row content: saved/loadout and active heading accent, disabled muted, available yellow, unloaded/read-only gray.
   - Treats loadout rows as recipe/spotlight rows: focusing one marks recipe item rows with `[·]`, Enter runs the recipe additively, and Space quick-selects recipe item rows for normal package actions; disable/remove remains a package-row action.

3. **Package operation layer**
   - Loads available sources with Pi's native project-local install path:
     ```bash
     pi install <source> -l --approve
     ```
   - For Available package child-resource selection, cache-inspects remembered sources with Pi's temporary resolver without network/download during dashboard build, shows child rows only when that cache already has multiple resources, then installs project-local, re-resolves the installed package resource list, warns if it differs from the cache, and writes package filters for selected resources when the user unfolds and confirms.
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
   - Matches package declarations with Pi-like source identity keys for npm, git, and local paths, so equivalent git spellings are one package in dashboard state and filter writes while the original project declaration string is preserved.

4. **Construct library layer**
   - User-local file: `~/.pi/agent/construct/catalog.json`.
   - Contains remembered package source strings and saved loadouts (`profiles` internally); direct project-local resources are not stored in the portable library yet.
   - Updated only by explicit `/construct load`, `/construct unload`, and `/construct save` commands.

5. **Known-project index layer**
   - User-local file: `~/.pi/agent/construct/projects.json`.
   - Tracks projects Construct has touched and their package declarations.
   - Counts are informational only and should be labeled as “known projects,” not full filesystem usage.
   - Counts stay in status/unload contexts and out of dashboard rows for now.
   - `/construct status full` can report entries whose saved paths are missing, but Construct does not prune the index automatically.

6. **Project metadata layer**
   - Project-local file: `.pi/construct.json`.
   - Advisory only; `.pi/settings.json` wins when there is disagreement.
   - Tracks Construct-managed package items and enabled state.

7. **Inventory layer**
   - `project-inventory.ts` is a read-only module that reconciles user library state, known projects, `.pi/settings.json`, `.pi/construct.json`, managed package metadata, unloaded package declarations, available library packages, and direct project resources for dashboard, status, save, and load candidate-discovery callers.
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
- Future direct-resource catalog items may use `kind: "extension" | "skill" | "prompt" | "theme"` plus a path/ref and portability marker; existing package items remain valid. Current saved loadouts/share snippets are deliberately package-source-only.
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

## Resource filter behavior

Construct uses Pi-native resource filters instead of inventing a separate enablement system.

For package rows, disabling keeps the package declaration in `.pi/settings.json` and sets all package resource families to empty arrays:

```json
{
  "source": "npm:some-pi-package",
  "extensions": [],
  "skills": [],
  "prompts": [],
  "themes": []
}
```

Enabling a package clears those all-empty filter keys and may collapse `{ "source": "..." }` back to string form. Decision: Construct does not snapshot and restore arbitrary prior partial filters. Package rows are whole-package loadout toggles only when the package is unfiltered or whole-package disabled; if a declaration already has partial Pi package filters, Construct skips the selected parent package row instead of overwriting those native resource-level selections.

For intentional partial package selection, the dashboard unfolds package rows with Right Arrow and writes exact package-relative path filters from child resource selections. Active and Disabled rows use Pi's project package resolver; Available rows are cache-inspected with Pi's temporary package resolver without network/download during dashboard build, show the normal collapsed arrow only when multiple resources are already known, have no hidden Right Arrow action when no cached multi-resource list is known, start child selections unchecked, and become project-local package declarations only after confirmation. Resource-level selection writes an explicit allowlist across all package resource kinds: selected current resources are listed, unselected current resources are omitted, and currently absent kinds get empty arrays so future package-added resources remain disabled until selected. If no package resources are selected, Construct writes all four package resource keys as empty arrays so the package is whole-package disabled. Construct never copies package-contained files into project `.pi/` resource folders.

For adopted direct project resources, disabling/enabling writes top-level Pi filter overrides such as `-skills/review/SKILL.md` or `+skills/review/SKILL.md` in the matching resource array. Construct never deletes direct resource files.

## Write behavior

Construct writes JSON through a shared helper that writes a complete temporary file in the same directory, flushes it, then renames it over the target. Direct `.pi/settings.json` edits still create a timestamped backup first.

## Related current docs

- `docs/product-model.md` defines the product boundary.
- `docs/commands-and-ux.md` defines the public command and dashboard behavior.
- `docs/safety-and-maintenance.md` records safety rules and maintenance risks.

## Lifecycle behavior

Construct does not open menus, install packages, reload Pi, or write files just because Pi starts or exits.
