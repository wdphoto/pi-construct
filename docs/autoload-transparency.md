# Autoload transparency

`/construct autoload` is an explicit opt-in convenience for noticing project package declarations that are already present in `.pi/settings.json` but not yet loaded into Construct.

Autoload is not package installation, trust management, or hidden sync.

## Rules

Autoload must remain:

- off by default;
- trusted-project only;
- TUI-only;
- source-visible;
- confirmation-only;
- metadata-only;
- easy to turn off.

It must never silently install packages, enable resources, reload Pi, execute package code, or edit `.pi/settings.json`.

## Current behavior

Autoload has two checks when enabled.

### Session watcher

On session start, Construct may attach one lightweight filesystem watcher only when all of these are true:

- `~/.pi/agent/construct/settings.json` has `autoload: true`;
- Pi is in TUI mode;
- UI is available;
- the project is trusted.

The watcher observes `.pi/settings.json` or the nearest available parent path, debounces events, waits until Pi is idle, re-reads project/Construct state, and asks before loading newly adoptable package declarations.

Prompt copy should keep the boundary obvious:

```text
Load new Pi package into Construct?

Construct autoload noticed a new project package declaration.

Package: <id>
Source: <source>

Load this source into the Construct library?
This only records the source and project metadata.
It does not install packages, enable resources, edit .pi/settings.json, or reload Pi.
```

### Quit-time scan

On session quit, Construct scans for remaining unloaded/adoptable project package declarations and asks before loading them. This is the reliable fallback for watcher misses and for users who install packages shortly before quitting.

## Why a watcher instead of an install hook?

Local Pi docs/types do not currently expose a stable package-install event for extensions. Construct should not depend on private package-manager internals or parse `pi install` output. If Pi later exposes a public package-install or settings-change event, prefer that over filesystem watching.

## Caveats

- `fs.watch` behavior differs by platform/filesystem.
- If `.pi/` or `.pi/settings.json` appears after the watcher starts, rebinding directly to the settings file would be more robust than the current parent-path watch.
- One prompt per new package is transparent but can be annoying when several packages appear at once.
- Live watcher prompts still need manual TUI verification.

## Possible simplification

If Construct continues to feel too heavy, the session watcher is a good candidate to remove. Exit-time autoload alone would preserve the safety model and most of the convenience while deleting timing complexity and modal mid-session prompts.
