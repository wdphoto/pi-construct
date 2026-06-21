# Safety and maintenance

## Safety principles

- Never install, execute, or load project-managed code outside Pi's existing project-resource/trust flow.
- Show source strings before package changes in the dashboard.
- Keep destructive actions explicit.
- Keep a backup of `.pi/settings.json` before direct edits.
- Treat skills as powerful: they can tell the model to execute scripts.
- Treat extensions as full-code-execution: they run with user permissions.
- Load mode must never install, execute, or validate remote package code; it only records source strings already declared by trusted project config.
- `defaultProjectTrust: "always"` is a personal-machine convenience, not something Construct should recommend for shared/untrusted repos.

## Conflicts and maintenance risks

- **Command name collisions:** multiple resources can register similar slash commands. Pi handles duplicate extension command names, but users still need visibility.
- **Tool name collisions:** extensions can override built-in tools or each other. Construct should warn clearly in future doctor/status output.
- **Package duplication:** the same package can exist globally and project-locally. Pi's package identity rules make the project entry win, but users need visibility.
- **Settings merge surprises:** project settings override/merge with global settings. Construct should show Installed/project-declared state clearly.
- **Resource filters:** package object filters can disable resources in subtle ways. Avoid partial resource toggles until needed.
- **Reload lifecycle:** after changing settings, old extension instances continue until reload completes. Treat `ctx.reload()` as terminal for the command handler.
- **Trust boundary confusion:** project trust is Pi's responsibility and is not a sandbox.
- **Non-interactive mode:** print/json modes cannot prompt. Keep them read-only or explicit.
- **Offline/network failures:** package install/update may fail or be intentionally disabled. Keep already-known state useful offline.
- **Project-specific resources:** local prompts/skills/extensions may contain repo-specific assumptions. Do not add raw local files to the reusable package library automatically.

## Maintenance strategy

- Use documented Pi APIs only; avoid importing Pi internals.
- Keep Pi-facing calls behind small adapter/helper layers.
- Prefer Pi CLI commands for package source changes instead of recreating package-manager behavior.
- Avoid parsing human CLI output.
- Keep the catalog schema forward-compatible: ignore unknown fields where safe and preserve unknown item metadata.
- Keep the UI simple before investing in deep custom TUI.

## Version-control policy

Usually commit/share:

- `.pi/settings.json` when the team wants the same Pi loadout.
- `.pi/prompts/`, `.pi/skills/`, `.pi/themes/`, and project-safe `.pi/extensions/` when authored for the repo.
- `.pi/construct.json` only if the team wants Construct advisory metadata shared.
- `AGENTS.md` / `CLAUDE.md` project guidance.

Usually do not commit:

- `.pi/npm/` and `.pi/git/` package caches/checkouts.
- `.pi/construct.lock.json` unless the team wants reproducibility metadata.
- secret-bearing config files.
- machine-specific local path recipes.

## What might not work

- Pi can install packages, but it cannot infer intent.
- Extension config is not standardized.
- Removing things cleanly is hard.
- One-click install can still require human setup.
- Sharing across machines is lossy, especially for absolute local paths.
- Other agents will not understand Construct automatically.
- Pi trust still comes first.
- Remembering everything can make the library noisy.

The idiomatic boundary remains: Construct manages normal Pi project declarations and advisory metadata; it does not become a separate resource system.
