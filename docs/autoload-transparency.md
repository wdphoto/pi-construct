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

Autoload is passive. When enabled, Construct checks on session quit for unloaded/adoptable project package declarations and asks before loading them.

Construct does not watch `.pi/settings.json` during the session. This keeps the feature quiet and avoids mid-session modal prompts, filesystem watcher edge cases, and parent-directory watch gaps.

Prompt copy should keep the boundary obvious:

```text
Load project resources into Construct?

Construct autoload found project resources that are not in the Construct yet.

- <id>: <source>

Load these before exit?
This will not install packages or edit .pi/settings.json.
```

If confirmed, Construct writes only the Construct library and selected `.pi/construct.json` metadata. It does not reload Pi.

## Why exit-time only?

Local Pi docs/types do not currently expose a stable package-install or settings-change event for extensions. Construct should not depend on private package-manager internals, parse `pi install` output, or keep a fragile filesystem watcher alive.

Exit-time autoload preserves the safety model and most of the convenience while keeping Construct passive: users finish their work, then Construct asks whether to remember newly declared project resources before leaving.

If Pi later exposes a public package-install or settings-change event, prefer that over filesystem watching.
