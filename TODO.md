# TODO

Scratchpad for research notes, open questions, and ideas that are not yet committed roadmap work. Decided work belongs in `MAP.md`.

## Research: Pi config and native resource configuration

- Study Pi's native `pi config` and resource-configuration flows.
- Look for idiomatic wording around package/resource enablement, project-local settings, filters, and trust.
- Decide what Construct can mirror without depending on brittle Pi internals.
- Question: can we reuse public APIs, or should we only copy UX patterns?

## Research: `/construct copy` and import snippets

Goal: export the current project's enabled Construct loadout as a shareable snippet.

Current bias:

- Print JSON first.
- Let the user copy/paste the snippet manually.
- Avoid direct dependency on Pi internal clipboard helpers unless a public API appears.
- Later, add import for the same snippet with preview/confirmation before writing.

Open questions:

- Command names: `/construct copy` and `/construct import`?
- Should the snippet represent only enabled Construct-managed resources, or also unloaded resources?
- Should it include a human name/profile name?
- Should it preserve exact source strings or normalize local paths out?

Possible snippet shape:

```json
{
  "version": 1,
  "kind": "construct-loadout",
  "name": "optional-name",
  "sources": ["npm:pi-web-access", "git:github.com/org/pi-tools"]
}
```

## Research: known-project assignment counts

Need counts that help users clean up/refactor Pi projects before unloading resources from Construct.

Current bias:

- Maintain a user-local known-project index under `~/.pi/agent/construct/`.
- Update it whenever Construct sees/touches a project.
- Count references by source string and maybe normalized source identity.
- Label as “known projects,” not “all projects.”

Open questions:

- What file name/schema? `projects.json`? `assignments.json`?
- Should stale/missing project paths be pruned automatically or only by a future doctor command?
- Assignment counts are informational only. Unload should not block or hard-warn when count > 1 because it does not delete/disable the resource from those projects.
- Should dashboard rows show counts, or only unload/status?

## Research: command wording

`load` and `unload` are staying, but their output needs to be clearer.

Open questions:

- Does “Construct forgot this resource” land better than “Removed from Construct”?
- Should unload output explicitly say “Still active in this project” when `.pi/settings.json` still has the source?
- Should `Unloaded` copy say “active in Pi, not loaded into Construct”?

## Ideas not yet committed

- First-run/never-loaded messaging for projects with no `.pi/construct.json`, triggered only by explicit `/construct`.
- Optional onboarding/startup automation behind explicit opt-in only.
- Groups/profiles as simple lists of remembered source ids.
- Pi package filters as a fine-grained toggle layer, e.g. keep a package declared but set `extensions: []`, `skills: []`, `prompts: []`, or `themes: []`.
