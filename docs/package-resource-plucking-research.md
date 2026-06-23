# Package resource plucking research

Status: research note, not committed product surface.

## Question

Can Construct show the skills, extensions, prompt templates, and themes inside a loaded Pi package and let the user choose only some of them for the current project?

Short answer: yes, for installed/project-declared packages. The Pi-native mechanism is package filters in `.pi/settings.json`; Construct should not copy package files into project-local `.pi/skills`, `.pi/extensions`, `.pi/prompts`, or `.pi/themes`.

## Pi behavior confirmed locally

Pi package settings support object-form filters:

```json
{
  "packages": [
    {
      "source": "./fat-package",
      "skills": ["skills/a/SKILL.md"],
      "prompts": [],
      "themes": [],
      "extensions": []
    }
  ]
}
```

Observed with `DefaultPackageManager.resolve()`:

- package resources have `metadata.origin === "package"`;
- `metadata.scope === "project"` for project installs;
- `metadata.source` is the settings source string;
- `metadata.baseDir` is the package root / install root;
- `resolved.path` is the concrete resource file;
- `resolved.enabled` reflects package filters.

Important filter detail:

- `skills: ["skills/a/SKILL.md"]` narrows skills to that exact skill and marks other skills disabled.
- `skills: ["+skills/a/SKILL.md"]` does **not** narrow by itself; `+` is a force-include override after the default include-all behavior.
- `[]` disables all resources of that type.
- Omitting a resource key loads that type using package defaults.

## Answer to “can we just install those to project-level?”

Yes, but not as independent project-local files.

The Pi-native version is:

1. keep the package as a project package declaration;
2. write package filters selecting the desired internal resources;
3. reload Pi.

Construct would be configuring the project to load selected resources from the package, not vendoring/copying those resources into `.pi/`.

For an available Construct library item that is not declared in the project yet, the safe flow is likely:

1. install the package to the project with `pi install <source> -l --approve`;
2. immediately rewrite the project package declaration to object form with selected filters before asking the user to reload;
3. update Construct project metadata as package-managed.

That keeps `.pi/settings.json` as the source of truth and avoids inventing a Construct package/resource format.

## What Construct knows today

Construct's catalog currently remembers package source strings only. It does **not** persist a package's internal resource inventory.

Current read-only inventory modules:

- `project-inventory.ts` reconciles package declarations, Construct metadata, catalog items, and direct project resources.
- `resources.ts` already uses Pi's `DefaultPackageManager.resolve()` but intentionally filters to direct project resources: `origin === "top-level" && scope === "project"`.

The package-resource version is therefore natural but should be separate:

- collect package resources from Pi resolver;
- keep package internals read-only until an explicit apply action;
- keep writes in package-operation helpers, not in inventory.

## Proposed modular flow

Use a deep module seam instead of spreading resolver/filter knowledge through dashboard code.

### Read-only package resource inventory

New module candidate: `extensions/construct/package-resources.ts`

Interface sketch:

```ts
export interface PackageResourceSummary {
  packageSource: string;
  packageMatchSources: string[];
  packageId?: string;
  kind: "extension" | "skill" | "prompt" | "theme";
  name: string;
  path: string;              // absolute resolved path
  packageRelativePath: string; // e.g. skills/a/SKILL.md
  enabled: boolean;
  scope: "project" | "user" | "temporary";
}

export async function collectProjectPackageResources(ctx, inventory): Promise<{
  resources: PackageResourceSummary[];
  warnings: string[];
}>;
```

Rules:

- include `metadata.origin === "package"`;
- start with `scope === "project"` only;
- match resources back to project package declarations / Construct managed packages by source identity;
- do not install missing packages in inventory; call resolver with `onMissing => "skip"`.

### Pure filter planner

New module candidate: `extensions/construct/package-filters.ts`

Interface sketch:

```ts
export interface PackageResourceSelection {
  source: string;
  selected: Record<"extensions" | "skills" | "prompts" | "themes", string[]>;
}

export function planPackageFilterEntry(existingEntry, selection): unknown;
```

Rules:

- selected paths are package-relative exact paths without `+`;
- empty arrays mean disable all resources of that type;
- no selected resources of any type is equivalent to whole-package disable and should reuse/align with current disable behavior;
- preserve unrelated fields on existing object package declarations.

### Write operation

Extend `package-ops.ts` / `project-settings.ts` with one narrow operation:

```ts
applyPackageResourceSelection(paths, { source, selection })
```

Rules:

- backup `.pi/settings.json` first;
- edit only the matching project package declaration;
- if package is not declared, install/add it to project first through the existing package load path, then convert to object form;
- re-read state before writing after any install;
- keep `.pi/construct.json` advisory and package-level for now; filters live in `.pi/settings.json`.

## UI shape options

Do not add a public command yet.

Possible TUI-only exploration path:

1. Dashboard shows normal package rows as today.
2. A focused package row can open a resource detail picker.
3. Detail picker groups resources by kind: Extensions, Skills, Prompts, Themes.
4. Enter applies the selected package filters and returns to the normal progress/result/reload flow.

This keeps `/construct` as the public surface and avoids turning Construct into a general package manager.

## Product boundaries to keep

For a first version:

- project-installed packages only;
- no saved-loadout filter recipes;
- no share/import of package resource selections;
- no copying package files into project-local `.pi/` resources;
- no browsing remote/uninstalled package internals unless the package is installed during an explicit apply flow;
- no global package filtering unless explicitly designed later.

## Main open decision

Should Construct remain source-only for saved loadouts, or eventually let saved loadouts remember `source + package filters`?

Recommendation for now: source-only saved loadouts stay unchanged. Package plucking is a current-project filter operation until users prove they need portable filter recipes.
