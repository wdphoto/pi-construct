# Construct Code Audit

Date: 2026-06-18

## Verdict

Overall: the MVP is in solid shape. The command surface, safety model, and smoke coverage are good. The main issues are around local path/source identity handling, catalog forward compatibility, and some duplicated command orchestration logic.

No critical security issues found.

## Follow-up status

The concrete fixes from this audit were implemented in this work session. See `audit-fix-plan.md` for the completed task list, verification commands, and remaining manual TUI check.

## Findings

### 1. Important: relative `requestedSource` can be normalized against the wrong base

Files:

- `extensions/construct/commands/dashboard.ts`
- `extensions/construct/commands/load.ts`
- `extensions/construct/commands/unload.ts`
- `extensions/construct/project-settings.ts`

If a user loads with a relative source like:

```text
/construct load ./pkg
```

Construct stores:

- `source`: Pi's declared source from `.pi/settings.json`
- `requestedSource`: `./pkg`

Later, some code prefers `requestedSource` and normalizes it relative to `.pi/settings.json`'s directory, i.e. `.pi/`, not project cwd. That can make an installed package appear OFF or unavailable.

Recommended fix:

- Use declared `source` for state matching.
- Use `requestedSource` only for display/replay, or store normalized absolute requested local paths.

### 2. Important: catalog/library writes drop unknown item fields

Files:

- `extensions/construct/catalog.ts`
- `extensions/construct/commands/catalog.ts`

`parseCatalog()` sanitizes items into `CatalogItem`, then writes that sanitized list back on add/remove/sync. That drops future fields like:

```json
"groups": ["review"]
```

This conflicts with the forward-compatible profile/groups direction.

Recommended fix:

- Preserve unknown item fields for valid package items.
- Add `groups?: string[]` if we already expect that shape.

### 3. Important/DRY: old compatibility `disable/remove` uses exact source matching

Files:

- `extensions/construct/commands/manage.ts`
- `extensions/construct/project-settings.ts`
- `extensions/construct/commands/unload.ts`

`/construct unload` has better normalized local path fallback logic. Older `disable/remove` paths use `removePackageDeclaration()` with exact string matching, so relative/absolute local path drift can fail.

Recommended fix:

- Move `removeMatchingPackageDeclaration()` into `project-settings.ts`.
- Reuse it from unload, disable, and remove.

### 4. DRY/UX: multi-item flows call full command handlers repeatedly

Files:

- `extensions/construct/commands/dashboard.ts`
- `extensions/construct/commands/load.ts`
- `extensions/construct/commands/unload.ts`

Examples:

- dashboard calls `handleLoad()` / `handleUnload()` per item
- `handleOn()` calls `handleLoad()` per item
- `handleOff()` calls `handleUnload()` per item

This causes repeated reads, repeated status/notify behavior, and makes output harder to control.

Recommended fix:

- Extract lower-level `loadPackage()` / `unloadPackage()` service functions.
- Have command handlers handle UI/output once.

### 5. DRY: source identity logic is scattered

Repeated concepts:

- get managed source
- prefer requested vs declared source
- normalize local paths
- compare raw and normalized sources
- classify active/off/local-only

Files:

- `dashboard.ts`
- `load.ts`
- `unload.ts`
- `sync.ts`
- `metadata.ts`
- `project-settings.ts`

Recommended fix:

- Add shared source helpers, for example:
  - `managedPackageSource()`
  - `normalizeDeclaredSource()`
  - `sourceMatches()`
  - `buildSourceIdentitySet()`

This would also help fix finding 1.

### 6. Dead/possibly stale code

Likely unused:

- `handleUnloadAll()` in `extensions/construct/commands/unload.ts`
- `planned()` in `extensions/construct/ui.ts`
- `syncProjectPackagesToCatalog()` in `extensions/construct/catalog.ts`

Recommended fix:

- Remove if not intentionally kept for debug.
- If kept, comment why.

### 7. Input parsing limitation: local paths with spaces

File:

- `extensions/construct/commands/catalog.ts`

`/construct remember <source> [id]` / catalog add split on whitespace:

```ts
const [rawSource, requestedId] = rest.split(/\s+/).filter(Boolean);
```

That breaks paths like:

```text
/Users/me/Code/local tools/pi-package
```

Recommended fix:

- Treat the last token as optional id only with an explicit flag, or support quoted parsing.
- Or keep simple but document that paths with spaces should use the UI/manual input.

### 8. Tests are good, but missing a few regressions

Good coverage already:

- smoke
- e2e load/unload/toggle
- install discovery
- invalid/drift cases

Missing useful cases:

- relative local source loaded via `./pkg`
- catalog item with `groups` survives remember/sync/remove operations
- compatibility disable/remove with relative-vs-normalized local paths
- `/construct sync` TUI behavior still needs manual keyboard pass

## Recommended fix order

1. Fix relative `requestedSource` handling.
2. Preserve unknown catalog fields.
3. DRY normalized package removal.
4. Extract load/unload service layer.
5. Remove dead code.
6. Add targeted smoke/regression cases.
