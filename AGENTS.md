# AGENTS.md

This repo is for planning and eventually building **the-construct**, a global Pi extension whose command surface is `/construct`.

## Project intent

- Build a friendly loadout manager for idiomatic Pi project-local config.
- Do not build a new package manager.
- The source of truth for project setup should remain normal Pi files like `.pi/settings.json`, `.pi/prompts/`, `.pi/skills/`, `.pi/extensions/`, and project package declarations.
- Keep global Pi lean; the global extension should provide commands, catalog/import/export, and onboarding only.

## Current status

- Planning only unless explicitly asked to implement.
- Main plan: `the-construct-plan.md`.

## Safety rules

- Do **not** edit live global Pi files unless explicitly requested:
  - `~/.pi/agent/auth.json`
  - `~/.pi/agent/settings.json`
  - `~/.pi/agent/npm/`
  - `~/.pi/agent/git/`
- Do not install the extension globally during early development.
- Test extensions with explicit loading, for example:
  ```bash
  pi --no-extensions -e ./src/index.ts
  ```
- Prefer disposable fixture projects for testing project-local writes.
- Before editing any `.pi/settings.json`, create a backup.
- `/construct apply` should use conservative merge behavior: add missing declarations, preserve existing config, ask before overwrite/remove.
- Never write secrets, tokens, API keys, or auth material.

## Pi docs to consult before implementation

Use the installed Pi docs as the source of truth:

- Extensions: `/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/docs/extensions.md`
- Packages: `/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/docs/packages.md`
- Settings/project trust: `/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/docs/settings.md`
- Skills: `/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/docs/skills.md`
- Prompt templates: `/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/docs/prompt-templates.md`
- TUI/custom UI: `/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/docs/tui.md`
- Examples: `/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/examples/extensions/`

Relevant examples to review when coding:

- `project-trust.ts` only to understand Pi trust; the-construct should not own trust in MVP.
- `commands.ts` for slash command listing patterns.
- `tools.ts` for simple settings-list UI patterns.
- `dynamic-resources/index.ts` for future cwd/profile ideas, not MVP.
- `reload-runtime.ts` for safe reload command behavior.

## Naming

- Extension/package/project name: `the-construct`.
- User command: `/construct`.
- Human prompt: `Load it into the Construct? y/n`.

## Git/project hygiene

- Do not add generated package caches to this repo.
- Do not commit secrets.
- Keep plans/docs readable and low-tech.
