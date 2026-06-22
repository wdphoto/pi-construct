# MAP

Roadmap and action list for The Construct. If work is decided, track it here. Scratch/research notes live in `TODO.md`.

## v0.0.9 — clarity and cleanup safety

- [x] Clean up `/construct unload` output so it plainly says Construct forgot the resource, project package declarations were left alone, and the package may still be active/unloaded.
- [x] Add known-project assignment counts for resources before unload and in relevant list/status views.
- [x] Keep assignment counts informational only. Unload should not block or hard-warn just because a resource is used by multiple known projects, because unload does not delete it from those projects.
- [x] Design and implement the known-project index under `~/.pi/agent/construct/`.
- [x] Label assignment counts carefully as “known projects” so we do not imply a full filesystem scan.
- [x] Research Pi's native `pi config` and resource-configuration flows, then decide which UI/language patterns Construct should mirror. See `docs/pi-config-and-construct.md`.
- [x] Remove the quiet `/construct run` alias; `/construct` and “Construct Loadout” remain the public language.
- [x] Sweep active docs for stale `sync`, `reload`, `roadmap`, and old-plan language. Keep historical changelog entries intact.

## v0.0.x — autoload transparency

- [x] Keep `/construct autoload` as an explicit on/off toggle.
- [x] Keep autoload off by default, trusted-project/TUI-only, and always confirmed before writing.
- [x] Keep current exit-time scan as the safe baseline: on quit, show compatible unloaded project package declarations and ask before loading them into Construct.
- [x] Research whether Pi exposes a stable package-install event. If not, do not fake one as a hidden install hook.
- [x] Add an “after settings change” prompt for autoload-on projects: watch `.pi/settings.json` during a session, wait for idle, then offer to load newly declared compatible packages one by one.
- [x] Avoid silent under-the-hood adoption; show source strings and make the user confirm.

## v0.0.x — saved loadouts

See `docs/profiles-and-sharing-plan.md`. Public copy should say saved loadout / saved; `profile` is mostly the internal catalog model.

- [x] Add `/construct save <name>` as the canonical command for saving the current active Construct package-source grouping.
- [x] Add `/construct run <saved-name>` as the canonical command for applying/running a saved loadout in the current project.
- [x] Add `/construct list` as the canonical command for listing saved loadouts; remove unreleased saved/profile aliases.
- [x] Save only active Construct package sources. Disabled package declarations are skipped.
- [x] During TUI save, offer active package declarations not loaded into Construct; selected rows are loaded into Construct and included, unselected rows are skipped.
- [x] Never append or merge on save. If the saved name exists, TUI asks before replacing it; non-TUI replacement refuses for now.
- [x] Make save summaries show included, newly loaded/included, skipped active-unloaded, and skipped disabled counts.
- [x] Add smoke coverage for `/construct save`, `/construct list`, and `/construct run`.
- [x] Bring run/apply into the newer in-panel progress/result/reload flow used by the dashboard.
- [x] Fold saved loadouts into the main `/construct` TUI as compact recipe/spotlight rows that mark member package rows without turning disable/remove into saved-loadout group actions.
- [x] Let Space on a saved-loadout row quick-select its selectable member package rows while keeping Enter-on-saved additive.

## v0.0.x — saved loadout sharing

See `docs/profiles-and-sharing-plan.md`.

- [x] Add `/construct share <saved-name>` to print a small JSON snippet for a saved loadout.
- [x] Keep `/construct share` print-first for now. Do not depend on Pi internal clipboard helpers unless Pi exposes a public API.
- [x] Add `/construct remove <saved-name>` to delete only a saved loadout recipe.
- [x] Add `/construct import` for pasted saved-loadout snippets, with preview/confirmation before writing anything.
- [x] Define and validate the snippet schema: `kind`, `version`, `name`, active package sources only, no secrets, no local cache paths.
- [x] Warn on local path sources during share/import because they are usually not shareable across machines.
- [x] Add smoke coverage for share/import preview/remove using disposable projects and disposable HOME.
- [x] Add manual/TUI coverage notes for confirmed import writes.

## v0.0.x — native project resources

See `docs/project-resource-loadout-plan.md`. This follows saved loadouts so the resource model does not churn under the save/run UX.

- [x] Start treating Construct as a project-level Pi resource manager by adding read-only direct resource inventory.
- [x] Add status inventory support for native Pi resource kinds: packages, extensions, skills, prompts, and themes.
- [x] Use Pi's exported `DefaultPackageManager.resolve()` / `SettingsManager` model for resource inventory instead of reimplementing Pi discovery rules.
- [x] Show direct project resources such as `.pi/skills/*/SKILL.md`, `.pi/prompts/*.md`, `.pi/themes/*.json`, and `.pi/extensions/*.ts` in `/construct status full`.
- [x] Show direct project resources in the main `/construct` dashboard: Unloaded/read-only before adoption, Active/Disabled after adoption.
- [x] Extend `/construct load` to adopt unloaded direct project resources into project metadata without adding project-local files to the portable library.
- [x] Toggle Construct-managed direct resource enablement from the dashboard with Pi-native `+path` / `-path` settings overrides, matching `pi config` behavior.
- [x] Keep file deletion out of scope; direct resources are toggled with filters and no file deletion path was added.
- [x] Update dashboard language from package-centric `Installed` copy to resource-neutral `Active` copy in the same release as direct resources.
- [x] Add smoke coverage for direct skills, prompts, themes, and extensions.
- [x] Keep saved loadouts/share snippets package-source-only for this slice; portable direct-resource paths/export stay deferred.

## v0.0.x — autoload polish

- [ ] Manually verify autoload settings-watcher prompts in TUI.
- [ ] Consider richer autoload prompt choices: load now, ask on exit, ignore this session, turn autoload off.
- [ ] Consider batching multiple newly declared packages into one selectable prompt.
- [ ] Consider a less surprising notification-first flow before opening a modal prompt.
- [ ] Rebind the watcher directly to `.pi/settings.json` when the file appears after session start.
- [ ] Prefer a future public Pi package-install/settings-change event over filesystem watching if Pi exposes one.

## v0.0.x — project scan

- [ ] Add `/construct scan [path]` as an explicit read-only report for unloaded project-level Pi resources under a folder, defaulting to `~/Code`.
- [ ] Detect Pi projects by `.pi/settings.json`, `.pi/construct.json`, and project-local `.pi/extensions`, `.pi/skills`, `.pi/prompts`, or `.pi/themes` resources.
- [ ] Report package declarations not in the Construct library/current project metadata and direct project-local resources not adopted into that project's `.pi/construct.json`.
- [ ] Keep scan strictly read-only: no install, load, trust change, package execution, reload, or writes.
- [ ] Avoid expensive/noisy directories such as `node_modules`, `.git`, `.pi/npm`, `.pi/git`, `dist`, and `build`.
- [ ] Prefer conservative file parsing for scan over Pi runtime resolution unless a safe public resolver mode is confirmed.
- [ ] Keep output summary-oriented: projects scanned, projects with unloaded resources, unloaded packages, unadopted direct resources, and `No files were changed.`

## v0.0.x — dashboard polish

- [x] Prototype Pi-native filter-based disarm mode: keep package declarations but set package resource filters to `[]`. See `docs/package-disable-design.md`.
- [ ] Manually verify dashboard action keys in TUI: Space selects, Enter applies, `r` confirms/removes, result-panel Enter reloads.
- [x] Decide dashboard state/action language: Active, Disabled, Available, Unloaded; Enter applies Active/Disabled/Available transitions; Unloaded rows are read-only in `/construct`; no public `d` key.
- [x] Split dashboard row grammar into selection marker plus compact state icon: `[x]` selected, `✓`, `–`, `+`, `◇`; color only the state icon column in TUI: active green, disabled muted green, available yellow, unloaded gray.
- [ ] Tighten status/drift reporting for normalized local paths vs raw `.pi/settings.json` strings.
- [ ] Add conflict/doctor visibility for overlapping runtime tool names and duplicate package/resource provenance.

## Later

- [ ] Consider lazy imports for heavier Construct modules if dashboard/saved-loadout/share/import code grows, following pi-resource-center's startup-speed pattern. Keep the entrypoint lean.
- [ ] Polish package source labels, especially local paths, toward short labels like `local:<name>` while preserving exact source strings in metadata.
- [ ] Reference Pi's `DefaultPackageManager` and `SettingsManager` discovery patterns when implementing known-project counts, but keep Construct's model limited to user-local known projects rather than broad resource management.
- [ ] Resource-level package filters only if truly needed beyond the all-resources disabled state.
- [ ] Review when saved loadouts/share snippets should include portable direct resources; current decision is package-source-only.
- [ ] Optional local-file packaging/export for `.pi/extensions`, prompts, skills, and themes.
- [ ] Optional parallel package installs/removals, but only after safe locking or merge semantics exist.
