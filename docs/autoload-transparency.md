# Autoload transparency and watcher notes

This note records why `/construct autoload` exists, how the session watcher behaves, what it costs, and what should be improved before calling it polished.

## Goal

Autoload should make newly installed project-local Pi packages visible to Construct without becoming hidden automation.

The product promise:

- user opts in with `/construct autoload on`;
- Construct notices compatible project package declarations;
- Construct shows exact source strings;
- user confirms before any Construct write;
- Construct only records sources in its library/metadata;
- Pi remains responsible for install, trust, package loading, and security.

Autoload must not silently install, enable, reload, or edit `.pi/settings.json`.

## Current behavior

Autoload has two checks.

### Session-time settings watcher

When a session starts, Construct starts the watcher only if all of these are true:

- autoload is on in `~/.pi/agent/construct/settings.json`;
- mode is TUI;
- UI is available;
- the project is trusted.

The watcher:

1. records currently adoptable/unloaded package sources as already seen;
2. starts one `fs.watch` watcher for `.pi/settings.json` or the nearest available parent path;
3. debounces filesystem events for 2 seconds;
4. waits until Pi is idle and there are no pending messages;
5. re-reads project packages and Construct metadata/library;
6. computes newly adoptable package declarations;
7. prompts one package at a time before calling the same metadata-only load path as `/construct load`.

Prompt copy should stay clear about the boundary:

```text
Load new Pi package into Construct?

Construct autoload noticed a new project package declaration.

Package: <id>
Source: <source>

Load this source into the Construct library?
This only records the source and project metadata.
It does not install packages, enable resources, edit .pi/settings.json, or reload Pi.
```

### Exit-time fallback

On session quit, Construct still scans for unloaded/adoptable project package declarations and asks before loading them.

This catches cases the watcher misses and keeps the original safe behavior.

## Why not a real install listener?

Local Pi docs/types currently expose lifecycle, resource, session, input, user-bash, and tool events, but no stable package-install event.

Construct should not fake a hidden install hook by depending on private internals or parsing normal `pi install` output. If Pi later exposes a public package-install/settings-change event, prefer that over the filesystem watcher.

## Cost and performance

The watcher should be cheap for users and Pi sessions:

- it is opt-in;
- it runs only in trusted TUI projects;
- it uses one OS file watcher, not a polling loop;
- it does not recursively scan the repository;
- it only parses JSON after a settings-file change event;
- the idle-wait loop runs only after a change event and sleeps between checks;
- the watcher is closed on session shutdown or when autoload is turned off.

Expected overhead is negligible on normal machines. The main risk is not CPU or disk load; it is user annoyance from poorly timed prompts.

## Security posture

Autoload does not make package code safe. Pi package installation and project trust remain the security boundary.

Construct should keep saying this plainly:

- package sources are already declared in `.pi/settings.json` before Construct offers to load them;
- adopting into Construct only remembers source strings and writes advisory metadata;
- extensions can execute arbitrary code and skills can instruct the model to act;
- users should review third-party packages before installing them.

Autoload should never hide source strings or imply that Construct has vetted a package.

## Current caveats

- `fs.watch` behavior differs by platform and filesystem. The exit-time scan is the fallback.
- If `.pi/` or `.pi/settings.json` is created after the watcher starts, the current parent-path watch should catch many cases, but rebinding directly to the settings file would be more robust.
- The current prompt is one package at a time. This is transparent but can become annoying when several packages appear at once.
- The current prompt is modal. It may interrupt the user after a settings change once Pi becomes idle.
- Smoke tests cover autoload settings and command behavior, but live watcher prompts still need manual TUI verification.

## Better future UX

Potential improvements, in likely order:

1. **Richer prompt choices**
   ```text
   Load now
   Ask on exit
   Ignore this session
   Turn autoload off
   ```

2. **Batch prompt for multiple packages**
   ```text
   Construct noticed 3 new project packages.

   [ ] package-a  npm:package-a
   [ ] package-b  git:github.com/org/package-b
   [ ] package-c  ../local-package

   Space selects · Enter loads · Esc asks on exit
   ```

3. **Less surprising notification-first flow**
   Show a small notification/status first, then open a picker only if the user chooses to review.

4. **Rebind watcher when `.pi/settings.json` appears**
   If the session starts before `.pi/` exists, watch the parent only long enough to notice settings creation, then switch to watching the settings file directly.

5. **Public Pi event integration**
   If Pi exposes a stable package-install or settings-change event, prefer it over filesystem watching.

## Acceptance bar

Autoload is acceptable only if it remains:

- opt-in;
- trusted/TUI-only;
- source-visible;
- confirmation-only;
- metadata-only;
- easy to turn off;
- quiet when there is nothing new to load.
