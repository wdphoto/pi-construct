# Project resource loadout plan

Construct is expanding from a package loadout manager into a project-level Pi resource manager. Packages stay first-class, but skills, prompt templates, themes, and extensions must be visible and manageable too.

Status: direct project resource inventory is implemented in `/construct status full` and `/construct` using Pi's `DefaultPackageManager.resolve()` / `SettingsManager`. `/construct load` can adopt direct project resources into advisory project metadata without adding project-local files to the portable Construct library. Dashboard Enter can toggle Construct-managed direct resources with Pi-native `+path` / `-path` settings overrides. Saved loadouts/share snippets intentionally stay package-source-only for this slice; portable direct-resource application and sharing remain deferred.

## Decision

Construct should support every native Pi project resource kind that Pi exposes through project settings or trusted project-local discovery:

1. `package` declarations in `.pi/settings.json` `packages`
2. `extension` paths and files
3. `skill` paths and discovered `SKILL.md` entries
4. `prompt` template paths and `.md` files
5. `theme` paths and `.json` files

System prompt files (`.pi/SYSTEM.md` and `.pi/APPEND_SYSTEM.md`) are also Pi-native project resources, but they are file-level prompt overrides rather than entries in the four resource arrays. Treat them as a later, explicit slice after the five loadout kinds above are working.

## Research checked

Local Pi docs and implementation confirm the native model:

- `docs/settings.md`: project settings support `packages`, `extensions`, `skills`, `prompts`, and `themes` arrays; paths resolve relative to `.pi`; arrays support globs, `!`, `+path`, and `-path` overrides.
- `docs/packages.md`: packages bundle extensions, skills, prompts, and themes; package object filters use the same resource type keys.
- `docs/skills.md`: project skills load from `.pi/skills/`, `.agents/skills/`, packages, settings `skills`, and CLI paths. Pi discovers recursive `SKILL.md` directories and top-level `.md` files in `.pi/skills/`.
- `docs/prompt-templates.md`: project prompts load from `.pi/prompts/*.md`, packages, settings `prompts`, and CLI paths; auto-discovery is non-recursive.
- `docs/themes.md`: project themes load from `.pi/themes/*.json`, packages, settings `themes`, and CLI paths.
- `docs/extensions.md`: project extensions load from `.pi/extensions/*.ts|*.js`, `.pi/extensions/*/index.ts`, packages, and settings `extensions`; `ctx.reload()` reloads extensions, skills, prompts, and themes.
- `docs/security.md`: project trust gates `.pi/settings.json`, `.pi/extensions`, `.pi/skills`, `.pi/prompts`, `.pi/themes`, system prompt files, missing project packages, and project package-managed extensions.
- Pi exports `DefaultPackageManager`, `SettingsManager`, and `ResolvedPaths`. `DefaultPackageManager.resolve()` returns resolved `extensions`, `skills`, `prompts`, and `themes` with `path`, `enabled`, and provenance metadata.
- Pi's `pi config` TUI disables top-level resources by writing `-relative/path` into the matching settings array and enables them by writing `+relative/path`. Package resources are toggled by writing `+relative/path` or `-relative/path` into the package object's resource filter array.

## Support matrix

| Kind | Native declaration/discovery | Construct current | Planned support |
| --- | --- | --- | --- |
| Package | `.pi/settings.json` `packages` | Full MVP support | Keep first-class |
| Extension | `.pi/settings.json` `extensions`, `.pi/extensions/`, packages | Direct top-level inventory/load/toggle | Portable apply/share later |
| Skill | `.pi/settings.json` `skills`, `.pi/skills/`, `.agents/skills/`, packages | Direct top-level inventory/load/toggle | Portable apply/share later |
| Prompt | `.pi/settings.json` `prompts`, `.pi/prompts/`, packages | Direct top-level inventory/load/toggle | Portable apply/share later |
| Theme | `.pi/settings.json` `themes`, `.pi/themes/`, packages | Direct top-level inventory/load/toggle | Portable apply/share later |
| System prompt | `.pi/SYSTEM.md`, `.pi/APPEND_SYSTEM.md` | None | Later explicit file-resource slice |

We can support five primary loadout kinds now. The practical item count is not constrained by Pi; Construct UX should stay comfortable for dozens and add search/grouping before optimizing for hundreds.

## Product rules

- `.pi/settings.json` and project-local `.pi/` resources remain the source of truth.
- Construct metadata remains advisory.
- Pi trust remains Pi's decision; Construct must not bypass or replace trust.
- Direct local resources are not packages. Do not pretend a project-local `.pi/skills/foo` is portable to another project unless Construct has a safe copy/export/package flow.
- Packages remain the recommended share unit for cross-project reusable workflows.
- Saved loadouts/share snippets are package-source-only for now. Adopted direct project-local resources stay local metadata/toggle state until portable direct paths or an explicit export/copy format are designed.
- Local path resources can be reusable if their path is already reusable, for example `~/.pi-shared/skills` or `../team-pi/skills`.
- Removing a local auto-discovered file is out of scope. Construct can disable it by writing Pi-native `-path` overrides, but it should not delete skill/prompt/theme/extension files.
- Reload language should become resource-neutral: after changes, reload Pi resources with `/reload` or dashboard Enter.

## Model changes

### Catalog item union

Move from package-only catalog items to a resource union while preserving existing package entries:

```ts
type ResourceKind = "package" | "extension" | "skill" | "prompt" | "theme";

interface BaseCatalogItem {
  id: string;
  kind: ResourceKind;
  name?: string;
  description?: string;
  groups?: string[];
}

interface PackageCatalogItem extends BaseCatalogItem {
  kind: "package";
  source: string;
}

interface PathCatalogItem extends BaseCatalogItem {
  kind: "extension" | "skill" | "prompt" | "theme";
  path: string;
  baseDir?: string;
  portability: "portable-path" | "project-local";
  origin?: "settings" | "auto" | "package-filter";
}
```

Existing `kind: "package"` items remain valid. Unknown future fields should continue to be preserved.

### Project metadata

Allow `.pi/construct.json` `items` to store the same resource kinds. For direct resources, store enough advisory identity to match Pi's resolved resource inventory:

```json
{
  "kind": "skill",
  "path": ".pi/skills/review/SKILL.md",
  "baseDir": ".pi",
  "enabled": true,
  "loadedAt": "...",
  "updatedAt": "..."
}
```

Prefer relative paths inside project metadata when the resource is under the project. Avoid generated cache paths, package install paths, secrets, and auth material.

### Known-project index

Replace or extend `packages: string[]` with resource refs, while keeping legacy reads:

```json
{
  "resources": [
    { "kind": "package", "source": "npm:pi-skills" },
    { "kind": "skill", "path": ".pi/skills/review/SKILL.md" }
  ]
}
```

Known-project counts remain informational only.

## Implementation plan

### Slice 1 — Inventory and status, read-only — implemented

- Add `ResourceKind` and resource identity helpers.
- Add a resource inventory module that uses exported Pi APIs:
  - `SettingsManager.create(paths.cwd, getAgentDir(), { projectTrusted: ctx.isProjectTrusted() })`
  - `new DefaultPackageManager({ cwd, agentDir, settingsManager }).resolve()`
- Merge package declarations from current code with resolved direct resources from Pi.
- Add `/construct status full` sections for direct resources by kind, scope, origin, enabled state, and path.
- Keep dashboard behavior package-only until inventory is verified.

Acceptance:

- A project with `.pi/skills/foo/SKILL.md` is reported as an unloaded skill.
- A project with `.pi/prompts/review.md`, `.pi/themes/foo.json`, and `.pi/extensions/tool.ts` reports each resource.
- Untrusted/non-TUI cases do not force project resource loading beyond Pi's trust state.

### Slice 2 — Dashboard rows for direct resources — implemented

- Generalize dashboard item naming from `DashboardPackage` to `DashboardResource`.
- Group or label rows by kind while preserving the quiet count title.
- Change user-facing count/state copy from package-specific to resource-neutral where needed.
- Show package-contained resources as details later; first pass should show the package row plus direct top-level resources.
- Keep direct resources actionable only when Construct can write a Pi-native setting safely.

Acceptance:

- `.pi/skills/foo/SKILL.md` appears as `Unloaded` until `/construct load` adopts it.
- Direct resources can be shown with kind labels without crowding package rows.
- Package rows keep current behavior.

### Slice 3 — Load/adopt direct resources — project-local metadata adoption implemented

- Extend `/construct load` to select unloaded packages and direct project resources.
- For direct resources, write advisory `.pi/construct.json` metadata.
- Do not add direct resources to the user catalog in this slice, even when their paths might be portable.
- Mark auto-discovered `.pi/...` resources as project-local; adopt them for current project management but do not offer them as installable in other projects yet.
- Review portable direct-resource catalog entries later for settings-declared reusable paths.

Acceptance:

- `/construct load` can adopt a local skill.
- Loading a project-local skill does not claim it is available in unrelated projects.
- Existing package load behavior is unchanged.

### Slice 4 — Enable/disable direct resources — implemented for Construct-managed direct rows

- Implement Pi-native top-level resource toggles using the same pattern as `pi config`:
  - disable: append/replace `-relative/path` in the matching settings array
  - enable: append/replace `+relative/path` or remove the matching `-relative/path` when safe
- For package resources, keep current all-resources package disable as-is; fine-grained package-contained resource toggles can come later.
- Back up `.pi/settings.json` before writing.
- Re-read settings after idle waits before merging/writing.

Acceptance:

- Enter on an active direct skill disables it by writing a `-skills/...` override.
- Enter on a disabled direct skill enables it by writing a `+skills/...` override or clearing the exact disable.
- `/reload`/dashboard Enter activates the changed state.

### Slice 5 — Apply/remove direct resources

- Available portable direct resources apply by adding their path to the matching project settings array.
- Project-local catalog entries that are not portable remain visible as not applicable outside their source project.
- `r` removes explicit settings declarations for direct resources only after confirmation.
- `r` does not delete auto-discovered project files; for those, present disable as the safe operation.

Acceptance:

- A reusable skill path saved from settings can be applied to another project.
- A `.pi/skills/foo` skill cannot be silently copied into another project.
- Removing a direct resource declaration creates a backup and does not delete files.

### Slice 6 — Saved loadouts and sharing — package-source-only for now

- Saved loadouts save active Construct-managed package sources only.
- Active direct resources, even after project-local adoption, are not included in saved loadouts or share snippets yet.
- Sharing snippets warn for local package paths and exclude project-local file contents unless an explicit export/copy format exists.
- Review portable direct-resource paths later, with package recommendations remaining prominent for reusable teams/workflows.

## UX notes

Resource row examples:

```text
[ ] ✓  skill     review        .pi/skills/review/SKILL.md
[ ] –  prompt    pr-review     .pi/prompts/pr-review.md
[ ] +  theme     tokyo-night   ~/.pi-shared/themes/tokyo-night.json
    ◇  extension guard        .pi/extensions/guard.ts
```

State language is resource-neutral:

- `Active`: enabled in this project
- `Disabled`: present but filtered off through Pi settings
- `Available`: remembered by Construct and applicable here
- `Unloaded`: present in this project but not Construct-managed

This replaced the package-centric `Installed` label in the same release as direct resources.

## Edge cases to test

- `.pi/skills/foo/SKILL.md` and `.pi/skills/foo.md`
- `.agents/skills/foo/SKILL.md` in cwd and ancestor directories
- Prompt templates in `.pi/prompts/` only load non-recursively by default
- Extension single files and `extensions/name/index.ts`
- Theme name collisions
- Disabled resources represented by `-path`
- Enabled overrides represented by `+path`
- Package filters with `extensions`, `skills`, `prompts`, `themes`
- Duplicate package/global/project resource paths where Pi precedence decides first winner
- Untrusted project sessions and non-interactive `-p` status
- Local path catalog items used from a different cwd

## Non-goals for first implementation

- No new package manager.
- No deletion of skill/prompt/theme/extension files.
- No broad filesystem scanning outside Pi's native project/user locations and settings declarations.
- No clipboard dependency for sharing.
- No automatic loading without confirmation.
- No fine-grained package-contained resource tree until top-level direct resources work.
