# Package resource picker plan

Status: next-stage plan for a small Construct-specific package-row picker.

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
- Available packages may be inspected lazily with Pi's temporary package resolver only after the user unfolds the row, then installed project-local only after the user confirms a child-resource selection.
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
   - Keep planner pure and testable.

2. Update inventory vocabulary. ✅
   - Preserve existing active/disabled/available/unloaded dashboard sections for now.
   - Add internal package filter detail so dashboard copy can warn when a package is partially filtered.

3. Protect existing toggles. ✅
   - If a package has partial filters, Construct now refuses the whole-package toggle rather than silently replacing them.
   - The future package resource picker is the route for intentional resource-level changes.

## Stage 2 — dashboard drill-down

Status: implemented as inline unfold plus `i` detail inspection on package rows.

Key model:

- focused package row + Right Arrow unfolds package resources inline;
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

Status: first implementation landed in the dashboard inline scaffold, including lazy inspect/install-with-filters for Available package rows.

Flow:

1. User focuses a package row.
2. Presses Right Arrow to unfold package resources.
3. Uses Space on child rows to choose exact target resources to keep enabled.
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
   - preserve unrelated package declaration fields;
   - update package-level Construct metadata only to keep the advisory enabled flag aligned when all resources are disabled or some are enabled;
   - show progress/result/reload flow.

Filter encoding:

- selected resources use plain exact relative paths, e.g. `skills/foo/SKILL.md`;
- empty arrays disable all resources of that kind;
- omitted keys mean package defaults;
- when all currently visible resources of a kind are selected, Construct clears that key back to Pi defaults;
- when no resources are selected for a package, Construct writes all four keys as empty arrays so the package is whole-package disabled.

Important Pi detail:

- `+path` is force-include, not a narrowing include by itself.
- For “only this resource,” use plain exact path entries.

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

- Should the dashboard show a clearer dirty/target marker for child rows after Space changes a resource target?
- Should partially filtered packages get their own dashboard row copy/state, or just a description badge?
- Should picker write all four resource filter arrays or only arrays touched by the user?

## Decisions made

- `r` remove remains package-level only from the dashboard. Package-contained child resources are filtered with Space/Enter rather than removed individually.
