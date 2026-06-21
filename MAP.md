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

## v0.0.x — autoload polish

- [ ] Manually verify autoload settings-watcher prompts in TUI.
- [ ] Consider richer autoload prompt choices: load now, ask on exit, ignore this session, turn autoload off.
- [ ] Consider batching multiple newly declared packages into one selectable prompt.
- [ ] Consider a less surprising notification-first flow before opening a modal prompt.
- [ ] Rebind the watcher directly to `.pi/settings.json` when the file appears after session start.
- [ ] Prefer a future public Pi package-install/settings-change event over filesystem watching if Pi exposes one.

## v0.0.x — shareable loadouts

- [ ] Add `/construct copy` to print a small JSON snippet for the current project's enabled Construct loadout.
- [ ] Keep `/construct copy` print-first for now. Do not depend on Pi internal clipboard helpers unless Pi exposes a public API.
- [ ] Add an import path for that snippet, likely `/construct import`, with preview/confirmation before writing anything.
- [ ] Define the snippet schema: version, sources, optional profile/name, no secrets, no local cache paths.
- [ ] Add smoke coverage for copy/import round trip using disposable projects.

## v0.0.x — dashboard polish

- [x] Prototype Pi-native filter-based disarm mode: keep package declarations but set package resource filters to `[]`. See `docs/package-disable-design.md`.
- [ ] Manually verify dashboard action keys in TUI: Space selects, Enter applies, `r` confirms/removes, result-panel Enter reloads.
- [x] Decide dashboard state/action language: Installed, Disabled, Available, Unloaded; Enter applies Installed/Disabled/Available transitions; Unloaded rows are read-only in `/construct`; no public `d` key.
- [x] Split dashboard row grammar into selection marker plus state badge: `[x]` selected, `✓ Active`, `– Disabled`, `+ Available`, `◇ Unloaded`; color state/section in TUI.
- [ ] Bring profile apply into the newer in-panel progress/result flow.
- [ ] Fold profiles into the main `/construct` TUI as first-class selectable rows/groups if it stays simple.
- [ ] Tighten status/drift reporting for normalized local paths vs raw `.pi/settings.json` strings.
- [ ] Add conflict/doctor visibility for overlapping runtime tool names and duplicate package/resource provenance.

## Later

- [ ] Consider lazy imports for heavier Construct modules if dashboard/profile/copy/import code grows, following pi-resource-center's startup-speed pattern. Keep the entrypoint lean.
- [ ] Polish package source labels, especially local paths, toward short labels like `local:<name>` while preserving exact source strings in metadata.
- [ ] Reference Pi's `DefaultPackageManager` and `SettingsManager` discovery patterns when implementing known-project counts, but keep Construct's model limited to user-local known projects rather than broad resource management.
- [ ] Resource-level package filters only if truly needed beyond the all-resources disabled state.
- [ ] Optional local-file packaging/export for `.pi/extensions`, prompts, skills, and themes.
- [ ] Optional parallel package installs/removals, but only after safe locking or merge semantics exist.
