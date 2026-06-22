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

## Research: known-project cleanup/doctor

Known-project assignment counts exist now and are informational only. Possible follow-up: a small doctor/cleanup flow that prunes missing project paths from `~/.pi/agent/construct/projects.json` after preview/confirmation.

Open questions:

- Should stale paths be pruned automatically when seen, or only through an explicit cleanup command?
- Should dashboard rows ever show known-project counts, or should counts stay in status/unload contexts?

## Ideas not yet committed

- Autoload follow-up: if Pi exposes a stable package-install event later, consider replacing or supplementing the `.pi/settings.json` watcher. Keep prompts explicit and source-visible.
- First-run/never-loaded messaging for projects with no `.pi/construct.json`, triggered only by explicit `/construct`.
- Optional onboarding/startup automation behind explicit opt-in only.
- Groups/profiles as simple lists of remembered source ids.
- Pi package filters as a fine-grained toggle layer, e.g. keep a package declared but set `extensions: []`, `skills: []`, `prompts: []`, or `themes: []`.
- Wishlist: optional package details view for individual package-contained resources. Example: a package/extension adds several skills, and Construct could someday show them underneath the package so a user can filter one skill off without disabling or removing the whole package. Keep this out of the main loadout view unless deliberately promoted; Pi config/resource-center already owns broad resource browsing.
