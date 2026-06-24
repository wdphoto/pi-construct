# Package resource picker plan

Status: implemented for package rows, with follow-up polish still tracked in `MAP.md`.

## Product direction

Build a focused dashboard drill-down for package rows only.

The goal is to make Construct feel like a friendly loadout manager while staying Pi-native:

- use Pi's resolver to see package-contained resources;
- use Pi package filters in `.pi/settings.json` to select resources;
- do not copy package files into project-local `.pi/skills`, `.pi/extensions`, `.pi/prompts`, or `.pi/themes`;
- do not add a new public slash command;
- do not turn Construct into a general package manager or remote package browser.

Native reference behavior: `pi config` already enables/disables package resources using `DefaultPackageManager.resolve()` and package filters. Construct should follow that model, but offer a smaller workflow tied to a focused package row in `/construct`.

## Recalibration notes

### What was right

- Construct's core source-only loadout model is still right.
- Saved loadouts as package source groups remain the simplest portable unit.
- Direct project-local resources are still distinct from package-contained resources.
- `.pi/settings.json` remains the source of truth for loaded package resources.

### What needs recalibration before writes

Current Construct package toggles are whole-package operations:

- disable writes empty `extensions`, `skills`, `prompts`, and `themes` arrays;
- enable clears those arrays.

That is acceptable for the current loadout manager, but it will clobber deliberate partial package filters. Before shipping a write-enabled package resource picker, Construct needs a safer filtered-package policy.

Likely policy:

- detect packages with non-empty resource filters as `filtered` rather than just active/disabled;
- do not use the old whole-package enable/disable path to erase partial filters without explicit confirmation;
- picker writes own selected filters intentionally;
- saved loadouts remain source-only until filter recipes are deliberately designed.

## Constraints for first implementation

- Project packages use `DefaultPackageManager.resolve()` and `scope === "project"`.
- Available packages may be cache-inspected with Pi's temporary package resolver during dashboard build, but without network/download. If the cache scan finds multiple resources, Right Arrow opens the child picker immediately; if no cached multi-resource list exists, the row has no hidden Right Arrow action and Enter installs the whole package. Zero-, one-resource, and unknown packages stay whole-package rows.
- No remote package browsing outside remembered Construct package sources.
- No saved-loadout filter recipes.
- No share/import of filter selections.
- No global package filtering.
- No broad package cache scanning.
- No direct-resource portability/export work in this stage.

## Stage 0 — done

- Research Pi package filter behavior.
- Confirm package resources are visible through Pi's resolver.
- Add `package-resources.ts` as read-only inventory.
- Show package-contained resources in `/construct status full`.

## Stage 1 — model and safety groundwork

Status: complete enough for the next read-only dashboard drill-down.

1. Add a package filter reader/planner module. ✅
   - Parse package declaration object filters.
   - Classify package filter state:
     - unfiltered/all-default;
     - whole-package disabled;
     - partially filtered;
     - invalid/unknown.
   - Keep planner pure and testable. The write planner now lives in `extensions/construct/package-resource-plans.ts` with smoke coverage for cross-kind path collisions and all-empty selections.

2. Update inventory vocabulary. ✅
   - Preserve existing active/disabled/available/unloaded dashboard sections for now.
   - Add internal package filter detail so dashboard copy can warn when a package is partially filtered.

3. Protect existing toggles. ✅
   - If a package has partial filters, Construct now refuses the whole-package toggle rather than silently replacing them.
   - The future package resource picker is the route for intentional resource-level changes.

## Stage 2 — dashboard drill-down

Status: implemented as inline unfold for installed package rows plus cache-inspected Available package rows with no hidden on-demand inspection.

Key model:

- focused installed package row + Right Arrow unfolds package resources inline when multiple resources are known;
- focused package row or child + Left Arrow folds;
- focused package row + `i` opens package resource details;
- Enter/Esc returns from detail panel to dashboard.

Panel content:

- package label/source;
- grouped resources: Extensions, Skills, Prompts, Themes;
- enabled/disabled markers from Pi resolver;
- package-relative paths;
- package filter write note for details.

## Stage 3 — write-enabled package picker

Status: first implementation landed in the dashboard inline scaffold, including cache-inspected install-with-filters for Available package rows when multiple resources are already known. The dashboard now hides the unfold affordance and Right Arrow action for packages with zero, one, or unknown resolved package resources.

Flow:

1. User focuses a package row.
2. Presses Right Arrow on a multi-resource package row to unfold package resources.
3. Uses Space on child rows to select resources for the next action; existing selected children toggle, while selected Available children install/enable.
4. Construct previews changes:
   - package source;
   - enabled counts by type;
   - disabled counts by type;
   - backup note;
   - reload needed note.
5. On confirm:
   - for Available package rows, install the remembered source project-local first;
   - backup `.pi/settings.json`;
   - re-read settings;
   - write object-form package filters using exact package-relative paths;
   - preserve unrelated package declaration fields;
   - for Available rows, re-resolve the installed project package before writing filters and warn if the cached temporary resource list changed;
   - update package-level Construct metadata only to keep the advisory enabled flag aligned when all resources are disabled or some are enabled;
   - show progress/result/reload flow.

Filter encoding:

- selected resources use plain exact relative paths, e.g. `skills/foo/SKILL.md`;
- empty arrays disable all resources of that kind;
- omitted keys mean package defaults and are used by whole-package row actions, not by child-resource plucking;
- child-resource selection writes an explicit allowlist across all four package resource kinds, so future package-added resources remain disabled until selected;
- when no resources are selected for a package, Construct writes all four keys as empty arrays so the package is whole-package disabled.

Important Pi detail:

- `+path` is force-include, not a narrowing include by itself.
- For “only this resource,” use plain exact path entries.

## Stage 3.1 — parent/child selection polish

Status: implemented for aggregate parent markers and clearer child target labels.

Goal: make package-contained resource selection feel predictable without turning the dashboard into a custom package browser.

Current behavior:

- A package row remains the whole-package action when no package-contained child resources are selected.
- Child row state icons show current state: `✓` active, `–` inactive, `+` available. The checkbox column is action selection, not current state.
- `[x]` on a child means the child is selected for the next action. Selected existing children are toggled on apply; unselected existing children keep their current state. Selected Available children are installed/enabled.
- A package row with resolved mixed child resources and no child selection shows `[~]` immediately, even before the user manually selects a child.
- Parent package markers summarize child selection presets: `[x]` all children selected, `[-]` active children selected, `[+]` inactive/available children selected, `[*]` custom child selection, `[~]` mixed current state with no child selection.
- Pressing Space on a package row cycles child selection presets: all → active → inactive/available → none.
- Collapsing a package must not discard child selection. Re-expanding should show the same child checks until the user applies or cancels the dashboard.
- Enter with selected child resources writes package filters and ignores whole-package row toggles for that package, preserving the current safety model.
- Enter on an Available package row with no selected children still installs the whole package with Pi defaults.
- Enter on an Active/Disabled package row with no selected children still uses the existing whole-package enable/disable behavior.

Implementation shape:

1. Keep the dashboard's inline tree. Do not add a new slash command, modal resource browser, or saved-loadout filter recipe.
2. Parent rows declare child ids and child selection groups (`active`, `inactive`, `available`) so the shared picker can render aggregate markers and run the parent Space cycle.
3. Keep changed tracking per child id, so resource filter plans are only created when child selections are pending.
4. Package resource confirmation copy should describe enabled resources after apply, because selected existing children are toggles rather than direct target-on choices.

## Stage 4 — saved loadout decision, later

Do not include package filters in saved loadouts yet.

Later decision only if users ask:

- Should a saved loadout remember `source + filter recipe`?
- How should share/import preview filter recipes safely?
- How should filter recipes behave when package contents change?

## Test plan

Add fixture packages with multiple resources per type.

Coverage targets:

- read-only inventory sees package resources by kind;
- filtered package shows enabled and disabled resources correctly;
- filter planner preserves unrelated package declaration fields;
- selecting one skill disables sibling skills when exact path filters are written;
- whole-package toggle does not silently erase partial filters after the safer policy lands;
- no `.pi/construct.json` resource entries are created for package-contained resources.

## Open questions

- Should partially filtered packages get their own dashboard row copy/state, or just a description badge?

## Decisions made

- `r` remove remains package-level only from the dashboard. Package-contained child resources are filtered with Space/Enter rather than removed individually.
